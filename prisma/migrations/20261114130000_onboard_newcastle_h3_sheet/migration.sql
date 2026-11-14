-- Add the Newcastle H3 hareline Google Sheet (hareline.nhhh.co.uk) as a second source
-- for the existing kennel newcastle-h3 (#2591). The kennel row is NOT touched.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the Source and
-- its SourceKennel link are applied here. prisma/seed-data/sources.ts carries the same row.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.
--
-- Trust 7 < Harrier Central 8: the sheet fills NULL fields (run number, venue, hares,
-- notes) and HC keeps winning conflicts. upcomingOnly clamps reconcile to the future so
-- the frozen archive backfill is never cancelled.

BEGIN;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_newcastle_h3_sheet', 'Newcastle H3 Hareline Sheet',
  'https://docs.google.com/spreadsheets/d/1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4/edit',
  'GOOGLE_SHEETS'::"SourceType",
  '{"upcomingOnly": true, "sheetId": "1qnLx61q1rYYagsZuWoAToBYi3ENY0E6Wt2OnJEXeFj4", "tabs": ["The Hareline - 2026"], "columns": {"runNumber": 0, "date": 2, "location": 4, "address": 5, "hares": 7, "description": 8}, "dayFirst": true, "requireRunNumber": true, "kennelTagRules": {"default": "newcastle-h3"}, "startTimeRules": {"byDayOfWeek": {"Wed": "19:00", "Sun": "11:30"}}}'::jsonb,
  7, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_newcastle_h3_sheet', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Newcastle H3 Hareline Sheet' AND s.type = 'GOOGLE_SHEETS'::"SourceType"
  AND k."kennelCode" = 'newcastle-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
