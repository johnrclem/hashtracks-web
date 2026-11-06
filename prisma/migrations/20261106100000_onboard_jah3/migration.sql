-- Onboard Jamaica H3 (jah3, jah3.com) — first 🇯🇲 Jamaica kennel (Kingston, est. 1998).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Jamaica/Kingston regions, the kennel, its aliases, the source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Jamaica" → METRO "Kingston".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_jamaica', 'Jamaica', 'jamaica', 'Jamaica', 'COUNTRY'::"RegionLevel", 'America/Jamaica', 'JM',
   'bg-emerald-200 text-emerald-800', '#059669', 18.1096, -77.2975,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_kingston_jm', 'Kingston', 'kingston', 'Jamaica', 'METRO'::"RegionLevel", 'America/Jamaica', 'KIN',
   'bg-emerald-100 text-emerald-700', '#10b981', 18.0179, -76.8099,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Kingston' AND c.name = 'Jamaica' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_jah3', 'jah3', 'Jamaica H3', 'jamaica-h3', 'Jamaica Hash House Harriers',
  'Kingston', r.id, 'Jamaica',
  'https://jah3.com/', 'https://www.facebook.com/groups/1611425852447494/',
  'Sunday', 'Biweekly',
  'Almost every 2nd Sunday afternoon, sometimes on other days; start time is up to the hares.',
  'J$1000', 1998, true, '/kennel-logos/jah3.gif',
  'Jamaica''s islandwide hash, based in Kingston — a drinking club with a running problem. Co-founded 13 Feb 1998 by Goran ''Nutcase'' Engdahl and Bill ''Bags'' Hetherington. A family hash laying trails across central and eastern Jamaica, usually every other Sunday afternoon.',
  18.0179, -76.8099,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Kingston'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_jah3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'JAH3'), (2, 'Jamaica H3'), (3, 'Jamaica Hash'),
             (4, 'Jamaica Hash House Harriers'), (5, 'Kingston Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'jah3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. The forward table ages out, so upcomingOnly is REQUIRED (reconcile
--    must never cancel past runs, including the one-shot backfilled archive).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_jah3_hareline', 'Jamaica H3 Website Hareline', 'https://www.jah3.com/kbean/hareline.php',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_jah3_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Jamaica H3 Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'jah3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
