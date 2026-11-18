-- Add the Basel-Stadt H3 (bsh3-ch) hareline source: basel.harrier.eu.org/hareline.php,
-- the kennel's own numbered run archive (Run #1, 1996-01-13 → present). Source-add only;
-- the kennel row, aliases and Meetup source already exist. Closes #2798.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`. Mirrors
-- prisma/seed-data/sources.ts. Idempotent (ON CONFLICT on natural keys).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Source. upcomingOnly clamps reconcile to the future so the backfilled history is never cancelled.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_bsh3_ch_hareline', 'Basel-Stadt H3 Hareline', 'https://basel.harrier.eu.org/hareline.php',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true, "kennelTag": "bsh3-ch"}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 2. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_bsh3_ch_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Basel-Stadt H3 Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'bsh3-ch'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
