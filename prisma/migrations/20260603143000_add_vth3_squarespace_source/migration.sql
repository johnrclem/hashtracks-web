-- VTH3 rich primary source (#1941).
--
-- Von Tramp H3 (vth3) has no reliably-working source: its Meetup source is
-- dead (#1144/#1459, disabled in 20260603075924_triage_hkfh3_rename_elah3_hide)
-- and its Facebook Hosted Events source is blocked by the datacenter-IP
-- checkpoint (#1939). The kennel's own Squarespace hareline
-- (vontramph3.com/hareline) exposes the full archive via ?format=json and is
-- parsed by the shared SquarespaceEventsAdapter.
--
-- The seed files (prisma/seed-data/sources.ts + registry.ts) carry the same
-- Source so fresh DBs land identical data, but Vercel runs only
-- `prisma migrate deploy` (never `prisma db seed`). Without this migration the
-- new Source would never reach prod and the kennel would stay dark. Structure +
-- idioms mirror 20260521020000_fix_se_asia_static_schedules (deterministic
-- literal ids — no pgcrypto/gen_random_uuid; NOTICE-not-RAISE on a missing seed
-- row so a pre-seed deploy doesn't abort; ON CONFLICT upsert so re-runs and an
-- already-seeded row are no-ops; SourceKennel link resolved by (name,type) so
-- it attaches correctly even when the Source pre-existed).

BEGIN;

-- ===== Insert/converge the VTH3 Squarespace source + kennel link =====
DO $$
DECLARE
  v_source_id   text := 'mig_1941_vth3_squarespace';
  v_sk_id       text := 'mig_1941_vth3_sk';
  v_source_name text := 'Von Tramp H3 Squarespace Events';
  v_source_url  text := 'https://www.vontramph3.com';
  v_kennel_code text := 'vth3';
  v_config      jsonb := jsonb_build_object('kennelTag', 'vth3', 'collectionPath', '/hareline');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — source link will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Upsert the Source on its (name, type) seed identity. ON CONFLICT keeps the
  -- existing row's id (e.g. if a manual `prisma db seed` already created it) and
  -- converges the config/trust/window onto the desired shape.
  INSERT INTO "Source" (
    id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
    enabled, "healthStatus", "createdAt", "updatedAt"
  )
  VALUES (
    v_source_id, v_source_name, v_source_url, 'HTML_SCRAPER'::"SourceType", v_config,
    9, 'daily', 3650, true, 'UNKNOWN'::"SourceHealth", NOW(), NOW()
  )
  ON CONFLICT (name, type) DO UPDATE SET
    url = EXCLUDED.url,
    config = EXCLUDED.config,
    "trustLevel" = EXCLUDED."trustLevel",
    "scrapeFreq" = EXCLUDED."scrapeFreq",
    "scrapeDays" = EXCLUDED."scrapeDays",
    enabled = true,
    "updatedAt" = NOW();

  -- Link the source to vth3. Resolve sourceId by (name, type) rather than the
  -- literal id so the link attaches to the surviving row even when the Source
  -- pre-existed under a different id. No-op when the Kennel is absent.
  INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
  SELECT v_sk_id, s.id, k.id
  FROM "Source" s, "Kennel" k
  WHERE s.name = v_source_name
    AND s.type = 'HTML_SCRAPER'::"SourceType"
    AND k."kennelCode" = v_kennel_code
  ON CONFLICT ("sourceId", "kennelId") DO NOTHING;
END $$;

-- ===== Verify post-state (no-ops cleanly on a pre-seed DB where vth3 absent) =====
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'vth3') THEN
    IF NOT EXISTS (
      SELECT 1 FROM "Source"
      WHERE name = 'Von Tramp H3 Squarespace Events'
        AND type = 'HTML_SCRAPER'::"SourceType"
        AND enabled = true
        AND "trustLevel" = 9
        AND config->>'collectionPath' = '/hareline'
    ) THEN
      RAISE EXCEPTION 'VTH3 Squarespace source missing/misconfigured after migration';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "SourceKennel" sk
      JOIN "Source" s ON s.id = sk."sourceId"
      JOIN "Kennel" k ON k.id = sk."kennelId"
      WHERE s.name = 'Von Tramp H3 Squarespace Events'
        AND s.type = 'HTML_SCRAPER'::"SourceType"
        AND k."kennelCode" = 'vth3'
    ) THEN
      RAISE EXCEPTION 'VTH3 Squarespace source not linked to the vth3 kennel after migration';
    END IF;
  END IF;
END $$;

COMMIT;
