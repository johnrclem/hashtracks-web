-- Onboard Bucharest H3 (bh3-ro, est. 1986) + Bucharest Full Moon H3 (bfmh3-ro) —
-- first 🇷🇴 Romania kennels, fed by one shared Google Sheet hareline.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Romania/Bucharest regions, both kennels, their aliases, the shared source and
-- both SourceKennel links are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Romania" → METRO "Bucharest".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_romania', 'Romania', 'romania', 'Romania', 'COUNTRY'::"RegionLevel", 'Europe/Bucharest', 'RO',
   'bg-indigo-200 text-indigo-800', '#4f46e5', 45.9432, 24.9668,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_bucharest_ro', 'Bucharest', 'bucharest', 'Romania', 'METRO'::"RegionLevel", 'Europe/Bucharest', 'BUH',
   'bg-indigo-100 text-indigo-700', '#6366f1', 44.4268, 26.1025,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Bucharest' AND c.name = 'Romania' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennels (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "instagramHandle", "scheduleDayOfWeek", "scheduleTime",
  "scheduleFrequency", "hashCash", "foundedYear", "walkersWelcome", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT t.id, t.code, t.short, t.slug, t.full_name, 'Bucharest', r.id, 'Romania',
       'https://bucharesthash.carrd.co/', 'https://www.facebook.com/BucharestHashHouseHarriersandHarrierettes',
       t.ig, t.dow, t.tm, t.freq, t.cash, t.founded, true, t.descr,
       44.4268, 26.1025, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r,
     (VALUES
       ('knl_bh3_ro', 'bh3-ro', 'Bucharest H3', 'bucharest-h3', 'Bucharest Hash House Harriers',
        'bucharest_hash', 'Sunday', '2:00 PM', 'Weekly', '50 Lei', 1986,
        'The Bucharest Hash House Harriers — a drinking/running/walking club established in 1986. A mixed group of expats and locals exploring the city on Sunday afternoon trails that end with a circle, food and beverages.'),
       ('knl_bfmh3_ro', 'bfmh3-ro', 'Bucharest Full Moon H3', 'bucharest-full-moon-h3',
        'Bucharest Full Moon Hash House Harriers', NULL, 'Friday', '7:00 PM', 'Full Moon', NULL, 2025,
        'The Bucharest Full Moon Hash House Harriers, sister hash to Bucharest H3, meets monthly on the Friday closest to the full moon at 19:00.'))
       AS t(id, code, short, slug, full_name, ig, dow, tm, freq, cash, founded, descr)
WHERE r.name = 'Bucharest'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT t.id, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES
  ('ka_bh3ro_1', 'bh3-ro', 'Bucharest H3'),
  ('ka_bh3ro_2', 'bh3-ro', 'Bucharest Hash'),
  ('ka_bh3ro_3', 'bh3-ro', 'Bucharest Hash House Harriers'),
  ('ka_bh3ro_4', 'bh3-ro', 'BH3-RO'),
  ('ka_bfmh3ro_1', 'bfmh3-ro', 'Bucharest Full Moon H3'),
  ('ka_bfmh3ro_2', 'bfmh3-ro', 'Bucharest Full Moon Hash'),
  ('ka_bfmh3ro_3', 'bfmh3-ro', 'Bucharest Full Moon Hash House Harriers'),
  ('ka_bfmh3ro_4', 'bfmh3-ro', 'BFMH3-RO'))
  AS t(id, code, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Shared source. The sheet keeps the full archive; upcomingOnly is REQUIRED
--    so reconcile never cancels the past rows the wide window loads.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_bh3_ro_sheet', 'Bucharest H3 Hareline Sheet',
  'https://docs.google.com/spreadsheets/d/17NUJ3M9Th9fPi9oYkK8cLGhydW7nNq6yFMyD0x34fkQ/export?format=csv&gid=0',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  7, 'daily', 1500, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel links (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_bh3_ro_sheet_' || k."kennelCode", s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Bucharest H3 Hareline Sheet' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" IN ('bh3-ro', 'bfmh3-ro')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
