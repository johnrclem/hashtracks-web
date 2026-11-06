-- Onboard H5 Hare & Hounds H3 (h5-gb, h5hashers.org.uk) — weekly Sunday 11:00
-- Bedfordshire / North Herts hash (since 1991), and the new Bedford METRO.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennel, aliases, source and SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Bedford METRO under the United Kingdom COUNTRY row.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_bedford_uk', 'Bedford', 'bedford', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'BDF',
  'bg-violet-100 text-violet-700', '#8b5cf6', 52.1364, -0.4667, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "foundedYear", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "dogFriendly", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_h5_hare_hounds_gb', 'h5-gb', 'H5 Hare & Hounds', 'h5-hare-hounds',
  'Hare and Hounds Hash House Harriers', 'Bedford', r.id, 'UK',
  'https://www.h5hashers.org.uk/', 1991, 'Sunday', 'Weekly', '11:00 AM', true,
  'The Hare & Hounds Hash House Harriers (H5) — ''the drinking club with a running problem'', hashing since 1991. Weekly trails from a different pub across Bedfordshire & North Hertfordshire, Sundays at 11am (Bank Holiday Mondays at 4pm). New runners and drinkers always welcome.',
  52.1364, -0.4667,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Bedford'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "H5" omitted — Harrisburg / Honolulu collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_h5gb_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Hare & Hounds H3'), (2, 'Hare and Hounds Hash House Harriers'), (3, 'Bedfordshire Hash'),
             (4, 'H5 Hare & Hounds'), (5, 'H5 Hare and Hounds'))
       AS t(n, alias)
WHERE k."kennelCode" = 'h5-gb'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Hareline source (forward-only → upcomingOnly).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_h5_gb_hareline', 'H5 Hare & Hounds Website Hareline', 'https://www.h5hashers.org.uk/hareline.php',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_h5_gb_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'H5 Hare & Hounds Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'h5-gb'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
