-- Onboard High Wycombe H3 (hwh3, hwh3.co.uk) — weekly Tuesday 19:45 Chilterns
-- hash, founded 5 March 1991. Adds the "High Wycombe" METRO under United Kingdom.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- region, the kennel, its aliases, its schedule rule, the website source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: High Wycombe METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_high_wycombe_uk', 'High Wycombe', 'high-wycombe', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'HWY', 'bg-violet-100 text-violet-700', '#8b5cf6',
  51.6287, -0.7482, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "logoUrl", "foundedYear", "dogFriendly", "walkersWelcome",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", description,
  "createdAt", "updatedAt"
)
SELECT
  'knl_hwh3', 'hwh3', 'High Wycombe H3', 'high-wycombe-h3', 'High Wycombe Hash House Harriers',
  'High Wycombe', r.id, 'UK',
  'https://www.hwh3.co.uk/', 'https://www.hwh3.co.uk/site/assets/images/logo.svg', 1991, true, true,
  'Tuesday', '7:45 PM', 'Weekly',
  'Weekly Tuesday-evening hash through the Chilterns countryside, starting from a pub within about 10 miles of High Wycombe. Long (~5 mi) and short (~3.4 mi) trails; dogs and walkers welcome. Running since 1991.',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'High Wycombe'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_hwh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'HWH3'), (2, 'High Wycombe Hash'), (3, 'High Wycombe HHH'), (4, 'Wycombe Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'hwh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Schedule rule (seed `scheduleRules`; Vercel never seeds, so it goes inline).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT
  'sr_hwh3_1', k.id, 'FREQ=WEEKLY;BYDAY=TU', '19:45', 'HIGH'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[hwh3]',
  NOW() AT TIME ZONE 'UTC', true, 'Weekly Tuesday', 0,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'hwh3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. The home-page Runs list is a rolling ~7-week window → upcomingOnly so
--    reconcile never cancels runs that age off it (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_hwh3_website', 'High Wycombe H3 Website', 'https://www.hwh3.co.uk/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true, "icsUrl": "https://www.hwh3.co.uk/hash-cal.ics"}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hwh3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'High Wycombe H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'hwh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
