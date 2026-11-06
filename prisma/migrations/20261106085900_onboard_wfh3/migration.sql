-- Onboard Wyre Forest H3 (wfh3, wyreforesthhh.org.uk) — weekly Thursday
-- 19:00 Worcestershire hash founded 2008, and the new Kidderminster METRO.
-- The site answers HTTP 406 to datacenter fetches, so the source routes
-- through the residential proxy (owner-approved 2026-11-05).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kidderminster METRO under the United Kingdom COUNTRY row.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_kidderminster_uk', 'Kidderminster', 'kidderminster', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'KID',
  'bg-violet-100 text-violet-700', '#8b5cf6', 52.388, -2.2497, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime", "foundedYear", "hashCash",
  description, "logoUrl", latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_wyre_forest_h3', 'wfh3', 'Wyre Forest H3', 'wyre-forest-h3', 'Wyre Forest Hash House Harriers',
  'Kidderminster', r.id, 'UK',
  'https://www.wyreforesthhh.org.uk/', 'Thursday', 'Weekly', '7:00 PM', 2008, '£1',
  'Wyre Forest Hash House Harriers — running in the beautiful countryside around the Wyre Forest (Kidderminster, Bewdley and beyond) every Thursday at 7pm. Everyone is welcome; all we ask is a £1 contribution towards the club''s insurance.',
  '/kennel-logos/wfh3.gif', 52.388, -2.2497,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Kidderminster'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_wfh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Wyre Forest H3'), (2, 'WFHHH'), (3, 'WFH3'), (4, 'Wyre Forest Hash'),
             (5, 'Wyre Forest Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'wfh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Hareline source (residential proxy; forward-only → upcomingOnly).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_wfh3_website', 'Wyre Forest HHH Website', 'https://www.wyreforesthhh.org.uk/index.php',
  'HTML_SCRAPER'::"SourceType", '{"useResidentialProxy": true, "upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_wfh3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Wyre Forest HHH Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'wfh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
