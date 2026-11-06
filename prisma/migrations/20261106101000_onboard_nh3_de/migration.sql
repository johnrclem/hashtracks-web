-- Onboard Nuremberg H3 (nh3-de) — roving Franconian hash. Adds the Nuremberg
-- METRO under the existing Germany COUNTRY.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_nuremberg_de', 'Nuremberg', 'nuremberg', 'Germany', 'METRO'::"RegionLevel", 'Europe/Berlin', 'NUE',
        'bg-yellow-100 text-yellow-700', '#eab308', 49.4521, 11.0767,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Nuremberg' AND c.name = 'Germany' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "hashCash", "dogFriendly", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_nh3_de', 'nh3-de', 'Nuremberg H3', 'nuremberg-h3', 'Nuremberg Hash House Harriers',
  'Nuremberg', r.id, 'Germany', 'https://nuremberg-h3.de/', 'https://www.facebook.com/NurembergHashHouseHarriers',
  'Saturday', '2:00 PM', 'Monthly',
  'Roughly monthly on Saturdays, roving across Franconia (Nürnberg, Bamberg, Bayreuth, Würzburg, Regensburg …).',
  '€5', true, true, '/kennel-logos/nh3-de.png',
  'A roving hash in Nuremberg and across Franconia: non-competitive walker and runner trails roughly once a month on Saturdays, usually near public transport, followed by a good Franconian beer. Dogs and walkers welcome.',
  49.4521, 11.0767, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Nuremberg'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_nh3de_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Nuremberg H3'), (2, 'Nürnberg H3'), (3, 'Nuremberg Hash House Harriers'), (4, 'NH3-DE'))
       AS t(n, alias)
WHERE k."kennelCode" = 'nh3-de'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_nh3_de_runinfo', 'Nuremberg H3 Run Info',
  'https://nuremberg-h3.de/wp-json/wp/v2/pages?slug=run-info',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  7, 'daily', 730, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_nh3_de_runinfo', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Nuremberg H3 Run Info' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'nh3-de'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
