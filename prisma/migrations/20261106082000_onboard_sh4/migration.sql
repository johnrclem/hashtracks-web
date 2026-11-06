-- Onboard South Hams H4 (sh4, sh4.org.uk) — weekly Wednesday 19:30 Devon
-- hash founded 1998, and the new South Hams METRO it lives in.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. South Hams METRO under the United Kingdom COUNTRY row (parent resolved by name).
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_south_hams_uk', 'South Hams', 'south-hams', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'SHM',
  'bg-violet-100 text-violet-700', '#8b5cf6', 50.283, -3.777, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "contactEmail", "foundedYear", "logoUrl",
  "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime", "hashCash", "walkersWelcome",
  description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_south_hams_h4', 'sh4', 'SH4', 'sh4', 'South Hams Hash House Harriers',
  'South Hams', r.id, 'UK',
  'https://www.sh4.org.uk/', 'https://www.facebook.com/groups/southhamsh3/', 'thewords@sh4.org.uk',
  1998, '/kennel-logos/sh4.png',
  'Wednesday', 'Weekly', '7:30 PM', '£2 (first run free; £40/calendar year)', true,
  'The South Hams Hash House Harriers (SH4) run every Wednesday, rain or shine, all year — meeting at 7:30pm, normally at a South Hams pub in Devon. A very social, all-abilities group with long/short splits; new members, visitors and holidaymakers always welcome. First run free.',
  50.283, -3.777,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'South Hams'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_sh4_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'South Hams Hash House Harriers'), (2, 'South Hams H4'), (3, 'South Hams H3'),
             (4, 'South Hams Hash'), (5, 'SH4 Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'sh4'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. List-of-Hashes source. Rolling list (~50 past rows), so upcomingOnly
--    keeps reconcile from cancelling runs that age off it.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_sh4_hash_diary', 'South Hams H3 (SH4) Website Hash Diary', 'https://www.sh4.org.uk/auto-draft/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_sh4_hash_diary', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'South Hams H3 (SH4) Website Hash Diary' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'sh4'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
