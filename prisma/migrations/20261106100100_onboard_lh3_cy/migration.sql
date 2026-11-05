-- Onboard Larnaca H3 (lh3-cy) — first 🇨🇾 Cyprus kennel (est. late May 1987).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Cyprus/Larnaca regions, the kennel, its aliases, its seasonal schedule rules,
-- the source and the SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Cyprus" → METRO "Larnaca".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_cyprus', 'Cyprus', 'cyprus', 'Cyprus', 'COUNTRY'::"RegionLevel", 'Asia/Nicosia', 'CY',
   'bg-amber-200 text-amber-800', '#d97706', 35.1264, 33.4299,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_larnaca_cy', 'Larnaca', 'larnaca', 'Cyprus', 'METRO'::"RegionLevel", 'Asia/Nicosia', 'LCA',
   'bg-amber-100 text-amber-700', '#f59e0b', 34.9167, 33.6333,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Larnaca' AND c.name = 'Cyprus' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "walkersWelcome", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_lh3_cy', 'lh3-cy', 'Larnaca H3', 'larnaca-h3', 'Larnaca Hash House Harriers',
  'Larnaca', r.id, 'Cyprus',
  'https://sites.google.com/view/larnaca-hash-house-harriers/the-larnaca-hash',
  'Monday', 'Weekly', 'Winter runs start at 4 PM, spring and autumn at 5 PM, summer at 6 PM.',
  '€4', 1987, true,
  'Larnaca Hash House Harriers, founded in late May 1987 — a very family-oriented hash (''clean names'') that runs every Monday evening on the eastern side of Cyprus. Runners and walkers both welcome; trails last around an hour and regularly muster 40+.',
  34.9167, 33.6333,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Larnaca'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_lh3cy_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Larnaca H3'), (2, 'Larnaca HHH'), (3, 'Larnaca Hash House Harriers'), (4, 'LH3-CY'))
       AS t(n, alias)
WHERE k."kennelCode" = 'lh3-cy'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Seasonal schedule rules (seed `scheduleRules`; Vercel never runs the seed's
--    schedule-rule pass, so they are inserted here on the same natural key).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT 'sr_lh3cy_' || t.n, k.id, t.rrule, t.start, 'HIGH'::"ScheduleConfidence",
       'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[lh3-cy]',
       NOW() AT TIME ZONE 'UTC', true, t.label, t.vfrom, t.vuntil, t.ord,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k,
     (VALUES
       (1, 'FREQ=WEEKLY;BYDAY=MO;BYMONTH=6,7,8', '18:00', 'Summer', '06-01', '08-31', 0),
       (2, 'FREQ=WEEKLY;BYDAY=MO;BYMONTH=3,4,5,9,10', '17:00', 'Spring/Autumn', '03-01', '10-31', 1),
       (3, 'FREQ=WEEKLY;BYDAY=MO;BYMONTH=11,12,1,2', '16:00', 'Winter', '11-01', '02-28', 2))
       AS t(n, rrule, start, label, vfrom, vuntil, ord)
WHERE k."kennelCode" = 'lh3-cy'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Rolling forward list, so upcomingOnly is REQUIRED.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_lh3_cy_nextrun', 'Larnaca H3 Website (Next Run + Future Hares)',
  'https://sites.google.com/view/larnaca-hash-house-harriers/next-run',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_lh3_cy_nextrun', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Larnaca H3 Website (Next Run + Future Hares)' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'lh3-cy'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
