-- Onboard Subic Bay H3 (sbh3-ph) — Olongapo / Subic Bay, Philippines (est. 26 Jul 1993).
-- Adds the Subic Bay METRO under the existing Philippines COUNTRY.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_subic_bay_ph', 'Subic Bay', 'subic-bay', 'Philippines', 'METRO'::"RegionLevel", 'Asia/Manila', 'SFS',
        'bg-fuchsia-100 text-fuchsia-700', '#c026d3', 14.8639, 120.2586,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Subic Bay' AND c.name = 'Philippines' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "foundedYear", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_sbh3_ph', 'sbh3-ph', 'Subic Bay H3', 'subic-bay-h3', 'Subic Bay Hash House Harriers',
  'Subic Bay', r.id, 'Philippines', 'https://subicbayhash.blogspot.com',
  'Monday', '2:00 PM', 'Weekly', 'Adult (18+) hash.', 1993,
  'Subic Bay Hash House Harriers — an adult (18+) hash founded 26 July 1993, running every Monday at 2:00 sharp from Barrio Barretto, Olongapo City / Subic Bay. ''The Hash with a view — IT''S NICE ON ICE.''',
  14.8639, 120.2586, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Subic Bay'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_sbh3ph_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Subic Bay H3'), (2, 'Subic Bay Hash'), (3, 'Subic Bay HHH'),
             (4, 'Subic Bay Hash House Harriers'), (5, 'SBH3-PH'), (6, 'Olongapo H3'))
       AS t(n, alias)
WHERE k."kennelCode" = 'sbh3-ph'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_sbh3_ph_blogger', 'Subic Bay H3 Blogger Hareline', 'https://subicbayhash.blogspot.com',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_sbh3_ph_blogger', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Subic Bay H3 Blogger Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'sbh3-ph'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
