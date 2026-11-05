-- Archive Source rows for the #2676 historical backfills.
--
-- scripts/backfill-wlh3-history.ts, backfill-sembach-h3-website-history.ts and
-- backfill-sffmh3-history.ts bind their RawEvents to a dedicated
-- `enabled: false, config.upcomingOnly: true` archive row. Binding a
-- one-shot historical backfill to a LIVE source whose reconcile window reaches
-- the backfilled dates lets the next daily scrape cancel everything inserted;
-- a separate archive row gives those events an "other source" RawEvent, which
-- reconcile never cancels (reconcile.ts other-source guard). Disabled, so the
-- rows are never scraped and never reconcile on their own.
--
-- prisma/seed-data/sources.ts carries the same three rows. Vercel runs only
-- `prisma migrate deploy` (never `db seed`), so prod is converged here.
-- Idempotent: ON CONFLICT on the (name, type) seed identity; the SourceKennel
-- link resolves the surviving row by (name, type). A missing kennel is a
-- NOTICE (pre-seed DB), not an abort.

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('mig_2676_wlh3_archive',    'mig_2676_wlh3_archive_sk',    'West London Hash Previous-Runs Archive', 'https://westlondonhash.com/previous-runs/',                    'wlh3'),
      ('mig_2676_sembach_archive', 'mig_2676_sembach_archive_sk', 'Sembach H3 Website Archive',             'https://sembach-hash.de/',                                     'sembach-h3'),
      ('mig_2676_sffmh3_archive',  'mig_2676_sffmh3_archive_sk',  'SFFMH3 Runs Archive',                    'https://www.sfh3.com/runs?kennel=7&kennels=7&period=all',      'sffmh3')
    ) AS t(source_id, sk_id, source_name, source_url, kennel_code)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = r.kennel_code) THEN  -- NOSONAR plsql:S1138
      RAISE NOTICE 'Kennel "%" not found — archive source link will no-op (run prisma db seed)', r.kennel_code;
    END IF;

    INSERT INTO "Source" (
      id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
      enabled, "healthStatus", "createdAt", "updatedAt"
    )
    VALUES (
      r.source_id, r.source_name, r.source_url, 'HTML_SCRAPER'::"SourceType",
      jsonb_build_object('upcomingOnly', true), 7, 'weekly', 90,
      false, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
    )
    ON CONFLICT (name, type) DO UPDATE SET
      enabled = false,
      config = "Source".config || jsonb_build_object('upcomingOnly', true),
      "updatedAt" = NOW() AT TIME ZONE 'UTC';

    INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
    SELECT r.sk_id, s.id, k.id
    FROM "Source" s, "Kennel" k
    WHERE s.name = r.source_name
      AND s.type = 'HTML_SCRAPER'::"SourceType"
      AND k."kennelCode" = r.kennel_code
    ON CONFLICT ("sourceId", "kennelId") DO NOTHING;
  END LOOP;
END $$;

COMMIT;
