-- Onboard City of Exeter H3 (coeh3, cityofexeterhhh.blogspot.com) — weekly
-- Sunday 11:00 Devon hash founded 2001, under the existing Exeter METRO.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- kennel, aliases, source and SourceKennel link are applied here.
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "instagramHandle", "scheduleDayOfWeek", "scheduleFrequency",
  "scheduleTime", "foundedYear", "dogFriendly", "walkersWelcome", description, "logoUrl",
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_city_of_exeter_h3', 'coeh3', 'City of Exeter H3', 'city-of-exeter-h3',
  'City of Exeter Hash House Harriers', 'Exeter', r.id, 'UK',
  'https://cityofexeterhhh.blogspot.com/', 'https://www.facebook.com/groups/cityofexeterh3', 'coe.h3',
  'Sunday', 'Weekly', '11:00 AM', 2001, true, true,
  'A non-competitive running/jogging/walking club meeting on Sunday mornings at 11am, usually within 15 miles of Exeter. Welcomes all abilities, dogs and families, with a walkers option of no more than 2.5 miles and longs of up to 6 miles. No need to sign up — just turn up.',
  '/kennel-logos/coeh3.gif', 50.7184, -3.5339,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Exeter'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Aliases (bare "EH3" omitted — Eugene / Enfield / Edmonton collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_coeh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'City of Exeter H3'), (2, 'City of Exeter Hash House Harriers'), (3, 'CoEH3'), (4, 'Exeter H3'))
       AS t(n, alias)
WHERE k."kennelCode" = 'coeh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Blogspot recap source. The adapter reads only the latest ~25 posts, so
--    upcomingOnly keeps reconcile from cancelling runs that scroll out.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_coeh3_blogspot', 'City of Exeter H3 Blogspot Recaps', 'https://cityofexeterhhh.blogspot.com/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 4. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_coeh3_blogspot', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'City of Exeter H3 Blogspot Recaps' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'coeh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
