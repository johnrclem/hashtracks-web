-- Onboard the Vientiane hashes — first 🇱🇦 Laos kennels: VH3 (vh3-la, est. 1981),
-- VBH3 (vbh3-la, est. 1998) and the Vientiane Bike Hash (vbikeh3-la, est. 2010),
-- all fed by one hashlaos.com source.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Laos/Vientiane regions, the three kennels, their aliases, the shared source and
-- the SourceKennel links are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Laos" → METRO "Vientiane".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_laos', 'Laos', 'laos', 'Laos', 'COUNTRY'::"RegionLevel", 'Asia/Vientiane', 'LAO',
   'bg-lime-200 text-lime-800', '#65a30d', 19.8563, 102.4955,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_vientiane_la', 'Vientiane', 'vientiane', 'Laos', 'METRO'::"RegionLevel", 'Asia/Vientiane', 'VTE',
   'bg-lime-100 text-lime-700', '#84cc16', 17.9757, 102.6331,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Vientiane' AND c.name = 'Laos' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennels.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT t.id, t.code, t.short, t.slug, t.full_name, 'Vientiane', r.id, 'Laos',
       t.web, t.fb, t.dow, t.tm, t.freq, t.notes, t.cash, t.founded, t.descr,
       17.9757, 102.6331, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r,
     (VALUES
       ('knl_vh3_la', 'vh3-la', 'VH3 Vientiane', 'vh3-vientiane', 'Vientiane Hash House Harriers',
        'https://hashlaos.com', 'https://www.facebook.com/groups/Laoshhh', 'Monday', '5:30 PM', 'Weekly', NULL,
        'Pay as you go', 1981,
        'The Vientiane Hash House Harriers, founded by Doug Stewart & Tom Holbrook with a first run on 13 April 1981 — the flagship Lao hash, with a weekly Monday-evening A-to-B town run in and around Vientiane.'),
       ('knl_vbh3_la', 'vbh3-la', 'VBH3 Vientiane', 'vbh3-vientiane', 'Vientiane Bush Hash House Harriers',
        'https://hashlaos.com/saturday-bush-hash/', NULL, 'Saturday', NULL, 'Weekly',
        'Late-afternoon countryside run (time posted weekly, e.g. 4:30 PM).',
        'Falang 70,000 Kip (80,000 first-timers) / Lao 30,000 Kip', 1998,
        'Vientiane''s Saturday countryside ''bush'' hash, formed in 1998 by six VH3 members who wanted a weekend run in the countryside rather than the suburbs; the first run was held on 14 June 1998.'),
       ('knl_vbikeh3_la', 'vbikeh3-la', 'Vientiane Bike Hash', 'vientiane-bike-hash', 'Vientiane Bike Hash',
        'https://hashlaos.com/monthly-bicycle-hash/', NULL, 'Sunday', '9:30 AM', 'Monthly',
        'Last Sunday of the month (sometimes moved); starts at JOMA Cafe near the Nam Phu Fountain.',
        '250,000 Kip', 2010,
        'The VH3 Monthly Bicycle Hash — an out-of-town bike hash founded by Graeme ''Mother Trucker'' Bolger, with Run #1 on 30 May 2010; held on the last Sunday of the month.'))
       AS t(id, code, short, slug, full_name, web, fb, dow, tm, freq, notes, cash, founded, descr)
WHERE r.name = 'Vientiane'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT t.id, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES
  ('ka_vh3la_1', 'vh3-la', 'Vientiane H3'),
  ('ka_vh3la_2', 'vh3-la', 'Vientiane Hash'),
  ('ka_vh3la_3', 'vh3-la', 'Vientiane Hash House Harriers'),
  ('ka_vh3la_4', 'vh3-la', 'VH3 Laos'),
  ('ka_vh3la_5', 'vh3-la', 'Vientiane Monday Hash'),
  ('ka_vbh3la_1', 'vbh3-la', 'VBH3'),
  ('ka_vbh3la_2', 'vbh3-la', 'Vientiane Bush Hash'),
  ('ka_vbh3la_3', 'vbh3-la', 'Vientiane Bush H3'),
  ('ka_vbh3la_4', 'vbh3-la', 'Saturday Bush Hash Vientiane'),
  ('ka_vbh3la_5', 'vbh3-la', 'VBH3 Laos'),
  ('ka_vbikeh3la_1', 'vbikeh3-la', 'Vientiane Bicycle Hash'),
  ('ka_vbikeh3la_2', 'vbikeh3-la', 'VH3 Bike Hash'),
  ('ka_vbikeh3la_3', 'vbikeh3-la', 'VTE Bike Hash'),
  ('ka_vbikeh3la_4', 'vbikeh3-la', 'Vientiane Monthly Bicycle Hash'))
  AS t(id, code, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Shared source. Pages are overwritten weekly, so upcomingOnly is REQUIRED.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_laos_hashlaos', 'Laos HHH Website (hashlaos.com)', 'https://hashlaos.com',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel links.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_laos_hashlaos_' || k."kennelCode", s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Laos HHH Website (hashlaos.com)' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" IN ('vh3-la', 'vbh3-la', 'vbikeh3-la')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
