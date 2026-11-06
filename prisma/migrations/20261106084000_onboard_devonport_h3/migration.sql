-- Onboard Devonport H3 (devonport-h3, dhash.com) — "The Odd Sock Hash", a
-- weekly Monday 18:45 hash on Tasmania's north-west coast. HashTracks' first
-- Tasmania kennel: adds the Tasmania STATE_PROVINCE and Devonport, TAS METRO.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- regions, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Tasmania STATE_PROVINCE under the Australia COUNTRY row.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_tasmania_au', 'Tasmania', 'tasmania', 'Australia', 'STATE_PROVINCE'::"RegionLevel",
  'Australia/Hobart', 'TAS', 'bg-yellow-100 text-yellow-700', '#713f12', -42, 146.6, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'Australia' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Devonport, TAS METRO under Tasmania.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_devonport_tas', 'Devonport, TAS', 'devonport-tas', 'Australia', 'METRO'::"RegionLevel",
  'Australia/Hobart', 'DPO', 'bg-yellow-200 text-yellow-800', '#eab308', -41.1789, 146.351, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'Tasmania'
ON CONFLICT (name) DO NOTHING;

-- 3. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "hashCash", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_devonport_h3', 'devonport-h3', 'Devonport H3', 'devonport-h3', 'Devonport Hash House Harriers',
  'Devonport, TAS', r.id, 'Australia',
  'https://www.dhash.com/', 'https://www.facebook.com/devonporthash',
  'Monday', 'Weekly', '6:45 PM', '$20',
  'Devonport Hash House Harriers — ''The Odd Sock Hash'' — a weekly Monday-evening hash on Tasmania''s north-west coast, running around Devonport, Ulverstone, Latrobe, Port Sorell and the surrounding area. 6:30pm for a 6:45pm sharp start; bring a torch.',
  -41.1789, 146.351,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Devonport, TAS'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 4. Aliases (bare "DH3" omitted — Dublin H3 owns it).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_devonporth3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Devonport H3'), (2, 'Devonport Hash'), (3, 'Devonport HHH'), (4, 'Odd Sock Hash'), (5, 'DHash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'devonport-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 5. Blogger source. Recent-window fetch → upcomingOnly keeps reconcile from
--    cancelling runs that scroll out.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_devonport_h3_blogger', 'Devonport H3 Blogger Feed', 'https://www.dhash.com/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_devonport_h3_blogger', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Devonport H3 Blogger Feed' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'devonport-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
