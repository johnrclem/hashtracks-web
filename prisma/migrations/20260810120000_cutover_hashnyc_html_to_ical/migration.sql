-- Cut hashnyc.com over from HTML_SCRAPER to ICAL_FEED.
--
-- hashnyc.com relaunched on a new "hash-attendance" app. The `table.past_hashes` /
-- `table.future_hashes` layout the bespoke Cheerio HashNYCAdapter scraped is GONE
-- (verified 2026-08-10: neither table appears in the homepage HTML), so the legacy
-- source can no longer see any events. The relaunched site publishes a structured
-- iCal feed at https://hashnyc.com/public/hareline.ics, so the source moves to the
-- shared ICalAdapter. Seed identity is (name, type), so the ICAL_FEED row is a
-- distinct row from the retired HTML_SCRAPER one.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so this migration
-- both (1) provisions the replacement ICAL_FEED Source row + its SourceKennel links
-- (mirroring prisma/seed-data/sources.ts) AND (2) disables the legacy HTML_SCRAPER row
-- in the SAME transaction. Doing both here means a deploy never leaves hashnyc.com with
-- no enabled source. A later `db seed` converges the same rows as a no-op.
-- Same shape as 20260622120100_onboard_fool_moon_h3_644 (source/kennel wiring in SQL).
--
-- The config JSONB duplicates the seed's kennelPatterns — unavoidable given "Vercel
-- never runs db seed". Migrations are immutable, so a future routing change is a new
-- migration + seed edit. JSONB escaping: "\\b" in this SQL literal stores as "\b"
-- (backslash + b, a regex word boundary), NOT a JSON backspace — verified through the
-- DB -> config::text -> JSON.parse -> RegExp round-trip.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING (Source + SourceKennel), and the retire
-- UPDATE only touches an *enabled* HTML_SCRAPER row. Safe to re-apply.

BEGIN;

-- 1. Provision the replacement ICAL_FEED source (create if absent; an existing /
--    seed-converged row is left untouched so admin edits aren't stomped).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "createdAt", "updatedAt"
)
VALUES (
  'src_hashnyc_ical_relaunch',
  'HashNYC Website',
  'https://hashnyc.com/public/hareline.ics',
  'ICAL_FEED'::"SourceType",
  '{
    "upcomingOnly": true,
    "kennelPatterns": [
      ["^Knickerbocker\\b|^Knick\\b", "knick"],
      ["^Queens Black Knights\\b|^QBK\\b", "qbk"],
      ["^NAWW(?:H3)?\\b", "nawwh3"],
      ["^New Amsterdam\\b|^NAH3\\b|^NASS\\b", "nah3"],
      ["^Long Island(?:\\s+Lunatics)?\\b|^LIL\\b", "lil"],
      ["^Staten Island\\b|^SI\\b", "si"],
      ["^Drinking Practice\\b", "drinking-practice-nyc"],
      ["^Brooklyn(?:\\s+H3)?\\b|^BrH3\\b|^BKH3\\b", "brh3"],
      ["^Harriettes\\b", "harriettes-nyc"],
      ["^Columbia\\b", "columbia"],
      ["^GGFM\\b", "ggfm"],
      ["^Queens\\b", "qbk"],
      ["^NYC(?:H3)?\\b", "nych3"]
    ],
    "defaultKennelTag": "nych3"
  }'::jsonb,
  8, 'daily', 365, true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 2. Link the 12 kennels the patterns route to (the merge pipeline's source-kennel
--    guard blocks events for unlinked kennels). Deterministic per-kennel ids so
--    re-runs converge; ON CONFLICT keeps any pre-existing link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hashnyc_ical_' || k."kennelCode", s.id, k.id
FROM "Source" s
JOIN "Kennel" k ON k."kennelCode" = ANY (ARRAY[
  'nych3', 'brh3', 'nah3', 'knick', 'lil', 'qbk', 'si', 'columbia',
  'harriettes-nyc', 'ggfm', 'nawwh3', 'drinking-practice-nyc'
])
WHERE s.name = 'HashNYC Website' AND s.type::text = 'ICAL_FEED'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 3. Retire the legacy HTML_SCRAPER row (only while still enabled -> idempotent).
UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'HashNYC Website'
  AND type::text = 'HTML_SCRAPER'
  AND enabled = true;

-- 4. Sanity NOTICEs (never fail the deploy) so a partial state is visible in the
--    build log and an operator knows to run `db seed`.
DO $$
DECLARE
  v_source_id text;
  v_linked    int;
BEGIN
  SELECT id INTO v_source_id FROM "Source"
  WHERE name = 'HashNYC Website' AND type::text = 'ICAL_FEED';
  IF v_source_id IS NULL THEN
    RAISE NOTICE 'ICAL_FEED "HashNYC Website" row missing after insert — check schema/enum';
  ELSE
    SELECT count(*) INTO v_linked FROM "SourceKennel" WHERE "sourceId" = v_source_id;
    IF v_linked < 12 THEN
      RAISE NOTICE 'HashNYC ICAL_FEED linked to % of 12 kennels — run db seed to reconcile', v_linked;
    END IF;
  END IF;
END $$;

COMMIT;
