-- Onboard Cebu H3 (cebu-h3) — Cebu City, Philippines (est. July 1997). Adds the
-- Cebu METRO under the existing Philippines COUNTRY.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_cebu_ph', 'Cebu', 'cebu', 'Philippines', 'METRO'::"RegionLevel", 'Asia/Manila', 'CEB',
        'bg-fuchsia-100 text-fuchsia-700', '#a21caf', 10.3157, 123.8854,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Cebu' AND c.name = 'Philippines' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "instagramHandle", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
  "hashCash", "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_cebu_h3', 'cebu-h3', 'Cebu H3', 'cebu-h3', 'Cebu Hash House Harriers',
  'Cebu', r.id, 'Philippines', 'https://cebuhash.wordpress.com/',
  'https://www.facebook.com/groups/1111927273013754', 'cebu_hash_house_harriers',
  'Sunday', '2:00 PM', 'Weekly', '₱100 (kids free)', 1997, true, '/kennel-logos/cebu-h3.jpg',
  'Cebu Hash House Harriers, founded July 1997 (first run 9 August 1997) — easy, mostly walked Sunday afternoon trails in and around Metro Cebu, its mountains and nearby islands, with an active social side. Registration ₱100, kids free; bring your own drinks.',
  10.3157, 123.8854, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Cebu'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_cebuh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Cebu H3'), (2, 'CebuH3'), (3, 'Cebu Hash'), (4, 'Cebu HHH'), (5, 'Cebu Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'cebu-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_cebu_h3_widget', 'Cebu H3 Upcoming Events Widget', 'https://cebuhash.wordpress.com/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_cebu_h3_widget', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Cebu H3 Upcoming Events Widget' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'cebu-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
