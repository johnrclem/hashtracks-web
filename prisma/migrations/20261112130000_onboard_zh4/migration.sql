-- Onboard Zagreb H4 (zh4, zagrebhash.com) — Zagreb Hash House Harriers &
-- Harriettes, first run 2 Jan 1975. HashTracks' first Croatia kennel: adds the
-- "Croatia" COUNTRY and "Zagreb" METRO regions (Serbia/Belgrade 2-level precedent).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- regions, the kennel, its aliases, its two seasonal schedule rules, the Google
-- Sheets source and the SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Croatia" → METRO "Zagreb".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_croatia', 'Croatia', 'croatia', 'Croatia', 'COUNTRY'::"RegionLevel", 'Europe/Zagreb', 'HR',
   'bg-blue-200 text-blue-800', '#2563eb', 45.1, 15.2,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_zagreb_hr', 'Zagreb', 'zagreb', 'Croatia', 'METRO'::"RegionLevel", 'Europe/Zagreb', 'ZAG',
   'bg-blue-100 text-blue-700', '#3b82f6', 45.815, 15.982,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Zagreb' AND c.name = 'Croatia' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "logoUrl",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "foundedYear", founder, "signatureEvent", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_zh4', 'zh4', 'Zagreb H4', 'zagreb-h4', 'Zagreb Hash House Harriers & Harriettes',
  'Zagreb', r.id, 'Croatia',
  'https://www.zagrebhash.com/', 'https://www.facebook.com/groups/1057978007592892/', '/kennel-logos/zh4.png',
  'Saturday', '11:00 AM', 'Biweekly',
  'Fortnightly Saturday 11:00 from autumn to spring; Monday 18:00 evenings in summer; anniversary run every 2 January. Start point per run on the ZH4 run-schedule sheet.',
  1975, 'Paul Redmond', 'Anniversary run every 2 January (Šumski prečac, top of Pantovčak)',
  'Zagreb''s hash, founded on 2 January 1975 by Paul Redmond of the Washington DC H3, and one of the oldest kennels in Europe. Trails run fortnightly on Saturday mornings from autumn to spring and on Monday evenings in summer, mostly in the Medvednica hills above the city, with an anniversary run every 2 January from the top of Pantovčak.',
  45.81, 15.98,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Zagreb'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases ("Zagreb H3" is Half-Mind #980's listing name).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_zh4_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Zagreb H4'), (2, 'ZH4'), (3, 'ZGH4'), (4, 'Zagreb H3'), (5, 'Zagreb Hash'),
             (6, 'Zagreb Hash House Harriers'), (7, 'Zagreb Hash House Harriers and Harriettes'))
       AS t(n, alias)
WHERE k."kennelCode" = 'zh4'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Seasonal schedule rules (seed `scheduleRules`; Vercel never seeds, so inline).
--    The summer rule is MEDIUM and anchored on the latest summer run (2026-06-01):
--    the summer cadence has been irregular.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  t.id, k.id, t.rrule, t.anchor, t.start_time, t.conf::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[zh4]',
  NOW() AT TIME ZONE 'UTC', true, t.label, t.valid_from, t.valid_until, t.ord,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k,
     (VALUES
       ('sr_zh4_1', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '2026-11-14', 'HIGH', '11:00', 'Autumn–spring Saturdays', '09-15', '04-30', 0),
       ('sr_zh4_2', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-06-01', 'MEDIUM', '18:00', 'Summer Monday evenings', '05-01', '09-14', 1))
       AS t(id, rrule, anchor, conf, start_time, label, valid_from, valid_until, ord)
WHERE k."kennelCode" = 'zh4'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Year tabs are auto-discovered; past runs arrive through the one-shot
--    backfill, and upcomingOnly clamps reconcile to the future so they're never cancelled.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_zh4_sheet', 'Zagreb H4 Run Schedule Sheet',
  'https://docs.google.com/spreadsheets/d/1lYHbq66X4aPfirLQR0jBtVsYIX3qLTwgEpOQo1FgM-M',
  'GOOGLE_SHEETS'::"SourceType",
  '{"upcomingOnly": true, "sheetId": "1lYHbq66X4aPfirLQR0jBtVsYIX3qLTwgEpOQo1FgM-M", "columns": {"runNumber": 0, "date": 2, "startTime": 3, "hares": 4, "location": 5}, "dayFirst": true, "requireRunNumber": true, "kennelTagRules": {"default": "zh4"}, "startTimeRules": {"byDayOfWeek": {"Sat": "11:00", "Mon": "18:00"}, "default": "11:00"}}'::jsonb,
  7, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_zh4_sheet', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Zagreb H4 Run Schedule Sheet' AND s.type = 'GOOGLE_SHEETS'::"SourceType"
  AND k."kennelCode" = 'zh4'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
