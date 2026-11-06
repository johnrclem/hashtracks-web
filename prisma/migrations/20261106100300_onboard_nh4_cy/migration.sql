-- Onboard Nicosia H4 (nh4-cy) — Cyprus, founded April 1989. Adds the Nicosia
-- METRO under the Cyprus COUNTRY from 20261106100100_onboard_lh3_cy.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_nicosia_cy', 'Nicosia', 'nicosia', 'Cyprus', 'METRO'::"RegionLevel", 'Asia/Nicosia', 'NIC',
        'bg-amber-100 text-amber-700', '#b45309', 35.1856, 33.3823,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Nicosia' AND c.name = 'Cyprus' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
  "hashCash", "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_nh4_cy', 'nh4-cy', 'Nicosia H4', 'nicosia-h4', 'Nicosia Hash House Harriers',
  'Nicosia', r.id, 'Cyprus', 'https://nh4.com.cy/', 'https://www.facebook.com/nh4cy/',
  'Tuesday', '7:15 PM', 'Weekly', '€3 run / €3–5 food', 1989, true, '/kennel-logos/nh4-cy.png',
  'Nicosia Hash House Harriers, founded April 1989 — meets every Tuesday evening, rain or shine, for a 6–8 km run (4–5 km walkers'' option) around Nicosia, then cold beer, circle ceremonies and local food. About 95 core members; 20–30 out each week.',
  35.1856, 33.3823,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Nicosia'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_nh4cy_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Nicosia H4'), (2, 'Nicosia HHH'), (3, 'Nicosia Hash House Harriers'),
             (4, 'Nicosia Horrible Hash House Harriers'), (5, 'NH4-CY'))
       AS t(n, alias)
WHERE k."kennelCode" = 'nh4-cy'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_nh4_cy_hareline', 'Nicosia H4 Upcoming Hares',
  'https://nh4.com.cy/index.php/hare-line/upcoming-hares',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_nh4_cy_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Nicosia H4 Upcoming Hares' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'nh4-cy'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
