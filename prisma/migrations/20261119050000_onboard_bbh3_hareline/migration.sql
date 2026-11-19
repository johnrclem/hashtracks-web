-- Add the Barbados Bike H3 forward hareline (hashcruise2020.simplesite.com/313623591) as a
-- second source for the existing kennel bbh3 (#2795). The kennel row is NOT touched.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the Source and
-- its SourceKennel link are applied here. prisma/seed-data/sources.ts carries the same row.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.
--
-- Trust 5 < Harrier Central 8: HC keeps winning venue/time/run number once a run is posted.
-- upcomingOnly clamps reconcile to the future: the page drops rows as they age off.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_bbh3_hareline', 'Barbados Bike H3 Hareline (website)',
  'https://hashcruise2020.simplesite.com/313623591',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true, "defaultStartTime": "06:00"}'::jsonb,
  5, 'daily', 450, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_bbh3_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Barbados Bike H3 Hareline (website)' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'bbh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
