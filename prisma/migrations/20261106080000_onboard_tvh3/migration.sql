-- Onboard Teign Valley H3 (tvh3, teignvalleyh3.com) — weekly Monday 19:15
-- South Devon hash, and the new Torbay METRO it lives in.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Torbay METRO under the United Kingdom COUNTRY row (parent resolved by name).
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_torbay_uk', 'Torbay', 'torbay', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'TBY',
  'bg-violet-100 text-violet-700', '#8b5cf6', 50.4619, -3.5253, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "walkersWelcome", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_teign_valley_h3', 'tvh3', 'Teign Valley H3', 'teign-valley-h3',
  'Teign Valley Hash House Harriers', 'Torbay', r.id, 'UK',
  'https://www.teignvalleyh3.com', 'https://www.facebook.com/groups/11332464730',
  'Monday', 'Weekly', '7:15 PM', true,
  'The ''Party Hash'' of South Devon — runs from pubs all over Torbay, Dartmoor and the Teign Valley every Monday evening at 7:15pm. Trails marked with flour, chalk or sawdust; typically 3-6 miles with short/long options or a leisurely walk; all abilities welcome. First run free.',
  50.4619, -3.5253,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Torbay'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_tvh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Teign Valley Hash House Harriers'), (2, 'TVH3'), (3, 'Teign Valley Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'tvh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Blogger source. The adapter reads only the latest ~30 posts, so
--    upcomingOnly keeps reconcile from cancelling runs that scroll out.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_tvh3_blogger', 'Teign Valley H3 Blogger Feed', 'https://www.teignvalleyh3.com/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_tvh3_blogger', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Teign Valley H3 Blogger Feed' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'tvh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
