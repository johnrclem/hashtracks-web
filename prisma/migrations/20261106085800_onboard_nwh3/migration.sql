-- Onboard North Wilts H3 (nwh3, weekly Sunday 11:00) and its Moonrakers
-- series (nwh3-moon, fortnightly Wednesday 19:00, since 1996) from nwh3.net,
-- plus the new Swindon METRO. Both sources use the shared
-- NorthWiltsHashAdapter, routed per kennel by Source.config.kennelTag.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- region, kennels, aliases, sources and SourceKennel links are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Swindon METRO under the United Kingdom COUNTRY row.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_swindon_uk', 'Swindon', 'swindon', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'SWN',
  'bg-violet-100 text-violet-700', '#8b5cf6', 51.5558, -1.7797, p.id,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennels (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "twitterHandle", "logoUrl", "scheduleDayOfWeek", "scheduleFrequency",
  "scheduleTime", "scheduleNotes", "foundedYear", "walkersWelcome", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  t.id, t.code, t.short_name, t.slug, t.full_name, 'Swindon', r.id, 'UK',
  t.website, 'https://www.facebook.com/NorthWiltsHHHSwindon/', 'NorthWiltsH3', t.logo,
  t.dow, t.freq, t.time, t.notes, t.founded, t.walkers, t.descr,
  51.5558, -1.7797, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r,
  (VALUES
    ('knl_north_wilts_h3', 'nwh3', 'North Wilts H3', 'north-wilts-h3', 'North Wilts Hash House Harriers',
     'https://nwh3.net', NULL::text, 'Sunday', 'Weekly', '11:00 AM',
     'Weekly Sunday 11:00 trail from a country pub around Swindon / North Wiltshire; fortnightly Wednesday ''Moonrakers'' evening runs are listed separately (nwh3-moon).',
     NULL::int, true,
     'Swindon''s friendliest running (and walking) club — a social hash meeting every Sunday for a run or walk in the countryside around Swindon. Trails are typically 5 miles, marked in flour, with options for keen runners and walkers alike.'),
    ('knl_north_wilts_moonrakers', 'nwh3-moon', 'Moonrakers H3', 'moonrakers-h3', 'North Wilts Hash House Harriers — Moonrakers',
     'https://nwh3.net/moonrakers.html', '/kennel-logos/nwh3-moon.png', 'Wednesday', 'Biweekly', '7:00 PM',
     'Fortnightly Wednesday evening run from a Swindon-area pub — bring a torch in winter.',
     1996, NULL::boolean,
     'North Wilts H3''s fortnightly Wednesday-evening series — torch-lit in winter — running from a pub around Swindon on alternate Wednesdays since February 1996.')
  ) AS t(id, code, short_name, slug, full_name, website, logo, dow, freq, time, notes, founded, walkers, descr)
WHERE r.name = 'Swindon'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT t.id, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES
  ('ka_nwh3_1', 'nwh3', 'NWH3'), ('ka_nwh3_2', 'nwh3', 'North Wilts Hash'),
  ('ka_nwh3_3', 'nwh3', 'North Wilts HHH'), ('ka_nwh3_4', 'nwh3', 'Swindon Hash'),
  ('ka_nwh3moon_1', 'nwh3-moon', 'Moonrakers H3'), ('ka_nwh3moon_2', 'nwh3-moon', 'Moonrakers'),
  ('ka_nwh3moon_3', 'nwh3-moon', 'NWH3 Moonrakers'), ('ka_nwh3moon_4', 'nwh3-moon', 'Moonraker Hash'),
  ('ka_nwh3moon_5', 'nwh3-moon', 'North Wilts Moonrakers')
) AS t(id, code, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Run-sheet sources (forward-only sheets → upcomingOnly; kennelTag routes the shared adapter).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES
  ('src_nwh3_runsheet', 'North Wilts H3 Run Sheet', 'https://nwh3.net/runsheet.html',
   'HTML_SCRAPER'::"SourceType", '{"kennelTag": "nwh3", "upcomingOnly": true}'::jsonb,
   6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('src_nwh3_moon_runsheet', 'North Wilts Moonrakers Run Sheet', 'https://nwh3.net/moonrakers.html',
   'HTML_SCRAPER'::"SourceType", '{"kennelTag": "nwh3-moon", "upcomingOnly": true}'::jsonb,
   6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel links (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT t.id, s.id, k.id
FROM (VALUES
  ('sk_nwh3_runsheet', 'North Wilts H3 Run Sheet', 'nwh3'),
  ('sk_nwh3_moon_runsheet', 'North Wilts Moonrakers Run Sheet', 'nwh3-moon')
) AS t(id, source_name, code)
JOIN "Source" s ON s.name = t.source_name AND s.type = 'HTML_SCRAPER'::"SourceType"
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
