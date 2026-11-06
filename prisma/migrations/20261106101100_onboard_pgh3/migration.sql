-- Onboard Puerto Galera H3 (pgh3) — Sabang, Puerto Galera, Philippines (est. Oct 1990).
-- Adds the Puerto Galera METRO under the existing Philippines COUNTRY.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_puerto_galera_ph', 'Puerto Galera', 'puerto-galera', 'Philippines', 'METRO'::"RegionLevel", 'Asia/Manila', 'PGA',
        'bg-fuchsia-100 text-fuchsia-700', '#e879f9', 13.5167, 120.9667,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Puerto Galera' AND c.name = 'Philippines' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "walkersWelcome", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_pgh3', 'pgh3', 'Puerto Galera H3', 'puerto-galera-h3', 'Puerto Galera Hash House Harriers',
  'Puerto Galera', r.id, 'Philippines', 'https://www.pgh3.org', 'https://www.facebook.com/PuertoGaleraHash',
  'Saturday', 'Weekly',
  'Saturday afternoons from Capt''n Greggs Dive Resort, Sabang Beach; departure 2:30–3:30 PM depending on season (posted per run).',
  '₱500 drinkers / ₱300 non-drinkers (kids under 14 free)', 1990, true,
  'Puerto Galera Hash House Harriers — a mixed hash founded in October 1990 by Dave ''Moby Dick'' Austin, running every Saturday afternoon from Capt''n Greggs Dive Resort on Sabang Beach. A-to-B trails of 4–6 km for runners and walkers around Puerto Galera, Oriental Mindoro.',
  13.5167, 120.9667, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Puerto Galera'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_pgh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'PGH3'), (2, 'Puerto Galera H3'), (3, 'Puerto Galera Hash'), (4, 'Puerto Galera Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'pgh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_pgh3_upcoming', 'Puerto Galera H3 Upcoming Runs', 'https://www.pgh3.org/upcoming-runs.html',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  7, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_pgh3_upcoming', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Puerto Galera H3 Upcoming Runs' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'pgh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
