-- Onboard Grenada H3 (gh3-gd) — first 🇬🇩 Grenada kennel (est. 1985).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Grenada / St George's regions, the kennel, its aliases, the source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Grenada" → METRO "St George's" (slug matches regionSlug()).
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_grenada', 'Grenada', 'grenada', 'Grenada', 'COUNTRY'::"RegionLevel", 'America/Grenada', 'GD',
   'bg-red-200 text-red-800', '#dc2626', 12.1165, -61.679,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_st_georges_gd', 'St George''s', 'st-georges', 'Grenada', 'METRO'::"RegionLevel", 'America/Grenada', 'GND',
   'bg-red-100 text-red-700', '#ef4444', 12.0561, -61.7488,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'St George''s' AND c.name = 'Grenada' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "dogFriendly", "walkersWelcome", "logoUrl", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_gh3_gd', 'gh3-gd', 'Grenada H3', 'grenada-h3', 'Grenada Hash House Harriers',
  'St George''s', r.id, 'Grenada', 'https://grenadahash.com/', 'https://www.facebook.com/groups/grenadahash',
  'Saturday', 'Weekly',
  'Saturday afternoons; arrive 30 minutes before the On On (3:30–4:00 PM, posted weekly on Next Hash).',
  'EC$3 (voluntary)', 1985, true, true, '/kennel-logos/gh3-gd.png',
  'Grenada Hash House Harriers, founded in 1985 by Paul ''Rigor Mortis'' Slinger. Every Saturday afternoon runners and walkers follow two trails at rotating locations around the Spice Isle (and Carriacou), then share Stag, Carib and local food. Dogs on a leash welcome; voluntary EC$3 hash cash.',
  12.0561, -61.7488, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'St George''s'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_gh3gd_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Grenada H3'), (2, 'Grenada Hash'), (3, 'Grenada HHH'), (4, 'Grenada Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'gh3-gd'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Rolling forward table, so upcomingOnly is REQUIRED.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_gh3_gd_schedule', 'Grenada H3 Hash Schedule', 'https://grenadahash.com/schedule/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_gh3_gd_schedule', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Grenada H3 Hash Schedule' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'gh3-gd'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
