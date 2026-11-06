-- Onboard N.E.W. Cotswold H3 (newch3, newch3.org.uk) — biweekly Sunday 11:00
-- hash across the North/East/West Cotswolds (founded 2019), and the new
-- Cotswolds METRO it lives in.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Cotswolds METRO under the United Kingdom COUNTRY row.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_cotswolds_uk', 'Cotswolds', 'cotswolds', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'COT',
  'bg-violet-100 text-violet-700', '#8b5cf6', 51.8875, -1.7594, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "contactEmail", "logoUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "foundedYear", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_new_cotswold_h3', 'newch3', 'N.E.W. Cotswold H3', 'new-cotswold-h3',
  'N.E.W. Cotswold Hash House Harriers', 'Cotswolds', r.id, 'UK',
  'https://www.newch3.org.uk', '4humansponge@gmail.com', '/kennel-logos/newch3.png',
  'Sunday', 'Biweekly', '11:00 AM', 2019,
  'N.E.W. Cotswold Hash House Harriers — out on trail in the North, East or West Cotswolds every other Sunday at 11:00am, across Gloucestershire, Worcestershire, Oxfordshire and Warwickshire.',
  51.8875, -1.7594,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Cotswolds'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_newch3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'NEW Cotswold H3'), (2, 'N.E.W. Cotswold HHH'), (3, 'NEWCH3'), (4, 'Cotswold H3'),
             (5, 'Cotswold Hash'), (6, 'New Cotswold Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'newch3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Homepage source (upcoming runs only → upcomingOnly).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_newch3_website', 'N.E.W. Cotswold H3 Website', 'https://www.newch3.org.uk/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_newch3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'N.E.W. Cotswold H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'newch3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
