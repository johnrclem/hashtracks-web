-- Onboard 13 config-only HARRIER_CENTRAL kennels (HC batch, Nov 2026):
--   yh3 (Leeds), oph3 (Okinawa), bdh3-uk (London), da2b (Plymouth), bbch3 (Birmingham),
--   cernh3 (Geneva), ph3-sr (Paramaribo), abujah3 (Abuja), blhhh (Adana), hannover-h3
--   (Hannover), mobh3 + bbh3 (Bridgetown), sunh3 (Raleigh, NC).
-- New regions: Suriname / Nigeria / Turkey (COUNTRY) + Leeds, Hannover, Geneva,
-- Paramaribo, Abuja, Adana (METRO, parented to their COUNTRY region).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the regions,
-- kennels, aliases, schedule rules, sources and SourceKennel links are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry the same
-- rows (this file was generated from them). Idempotent: ON CONFLICT on natural keys,
-- regions/kennels resolved by name/code (no hard-coded FK ids); safe to re-apply.
-- No RAISE — a missing parent region (e.g. on an empty shadow DB) inserts nothing
-- instead of failing `migrate dev`; the final NOTICE reports what landed.

BEGIN;

-- 1. Regions (COUNTRY rows first so the METRO parent lookup finds them).
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_suriname', 'Suriname', 'suriname', 'Suriname', 'COUNTRY'::"RegionLevel", 'America/Paramaribo', 'SR', 'bg-sky-200 text-sky-800', '#0284c7', 3.9193, -56.0278, NULL, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_nigeria', 'Nigeria', 'nigeria', 'Nigeria', 'COUNTRY'::"RegionLevel", 'Africa/Lagos', 'NG', 'bg-rose-200 text-rose-800', '#e11d48', 9.082, 8.6753, NULL, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_turkey', 'Turkey', 'turkey', 'Turkey', 'COUNTRY'::"RegionLevel", 'Europe/Istanbul', 'TR', 'bg-cyan-200 text-cyan-800', '#0891b2', 39, 35, NULL, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_leeds', 'Leeds', 'leeds', 'UK', 'METRO'::"RegionLevel", 'Europe/London', 'LDS', 'bg-violet-100 text-violet-700', '#8b5cf6', 53.8008, -1.5491, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'UK' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_hannover', 'Hannover', 'hannover', 'Germany', 'METRO'::"RegionLevel", 'Europe/Berlin', 'HAJ', 'bg-yellow-100 text-yellow-700', '#eab308', 52.3759, 9.732, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'Germany' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_geneva', 'Geneva', 'geneva', 'Switzerland', 'METRO'::"RegionLevel", 'Europe/Zurich', 'GVA', 'bg-red-100 text-red-700', '#fca5a5', 46.2044, 6.1432, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'Switzerland' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_paramaribo', 'Paramaribo', 'paramaribo', 'Suriname', 'METRO'::"RegionLevel", 'America/Paramaribo', 'PBM', 'bg-sky-100 text-sky-700', '#0ea5e9', 5.852, -55.2038, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'Suriname' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_abuja', 'Abuja', 'abuja', 'Nigeria', 'METRO'::"RegionLevel", 'Africa/Lagos', 'ABV', 'bg-rose-100 text-rose-700', '#f43f5e', 9.0765, 7.3986, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'Nigeria' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt")
VALUES ('rgn_adana', 'Adana', 'adana', 'Turkey', 'METRO'::"RegionLevel", 'Europe/Istanbul', 'ADA', 'bg-cyan-100 text-cyan-700', '#06b6d4', 37.0017, 35.4259, (SELECT p.id FROM "Region" p WHERE p.level = 'COUNTRY'::"RegionLevel" AND p.country = 'Turkey' LIMIT 1), NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

-- 2. Kennels (regionId resolved by region name).
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "website", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "hashCash", "facebookUrl", "foundedYear", "description", "logoUrl", "walkersWelcome", "createdAt", "updatedAt")
SELECT 'knl_hcnov_yh3', 'yh3', 'YH3', 'yh3', 'Yorkshire Hash House Harriers', 'Leeds', r.id, 'UK',
  'https://www.yorkshirehash.net/',
  'Sunday',
  '11:00 AM',
  'Biweekly',
  '£1.50 (visitors; members free)',
  'https://www.facebook.com/groups/YH3HashHouseHarriers/',
  1981,
  'Yorkshire Hash House Harriers (YH3) is a long-running West Yorkshire kennel — ''the drinking club with a running problem'' — founded in 1981. It hashes on alternate Sunday mornings around Leeds, Bradford, Saltaire, Halifax and the wider West Yorkshire area, with separate trails for runners and walkers followed by the usual down-downs in the pub. Its annual highlight is the AGPU (Annual General Piss Up) weekend. Newcomers welcome. On On!',
  '/kennel-logos/yh3.avif',
  true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Leeds'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "website", "scheduleTime", "scheduleFrequency", "scheduleNotes", "hashCash", "facebookUrl", "instagramHandle", "description", "logoUrl", "latitude", "longitude", "walkersWelcome", "createdAt", "updatedAt")
SELECT 'knl_hcnov_oph3', 'oph3', 'OPH3', 'oph3', 'Okinawa Poofters Hash House Harriers', 'Okinawa', r.id, 'Japan',
  'https://okinawah3.wixsite.com/okih3',
  '7:00 PM',
  'Biweekly',
  'Poofter Trail — weekday evenings, day varies (~19:00)',
  '¥800',
  'https://www.facebook.com/OkinawaH3',
  'okinawah3',
  'The Okinawa Poofters (OPH3) is the mid-week ''Poofter Trail'' series of the Okinawa Hash House Harriers on Okinawa Island, Japan — a drinking club with a running problem. Biweekly weekday-evening trails (~19:00) across Okinawa; 2–5 mile run/walk trails through the Ryukyus. First trail free.',
  '/kennel-logos/oph3.png',
  26.34,
  127.77,
  true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Okinawa'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "createdAt", "updatedAt")
SELECT 'knl_hcnov_bdh3_uk', 'bdh3-uk', 'Black Death H3', 'black-death-h3', 'Black Death Hash House Harriers', 'London', r.id, 'UK',
  'Sunday',
  '12:00 PM',
  'Biweekly',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'London'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "website", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes", "hashCash", "description", "logoUrl", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_da2b', 'da2b', 'DA2B', 'da2b', 'Devon A to B Hash House Harriers', 'Plymouth', r.id, 'UK',
  'http://devonatobh3.blogspot.com/',
  'Saturday',
  '12:30 PM',
  'Monthly',
  'First Saturday of the month — A-to-B ''mystery tour'', 8+ miles, beer stops, transport back to start.',
  '£5',
  'Devon''s monthly A-to-B ''mystery tour'' hash — first Saturday of the month, at least 8 miles from Point A to a secret Point B known only to the Hares and the Beermaster, with beer stops en route and transport back to the start.',
  '/kennel-logos/da2b.png',
  50.3,
  -3.8,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Plymouth'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "hashCash", "foundedYear", "description", "logoUrl", "latitude", "longitude", "walkersWelcome", "createdAt", "updatedAt")
SELECT 'knl_hcnov_bbch3', 'bbch3', 'BBCH3', 'bbch3', 'Brum and Black Country Hash House Harriers', 'Birmingham', r.id, 'UK',
  '£5',
  2026,
  'Birmingham / Black Country hash, founded September 2026. A-A trails (start & finish at the same spot), 8-12km for runners and 5-6km for walkers, with an Indian-restaurant On After.',
  '/kennel-logos/bbch3.avif',
  52.4577,
  -1.9981,
  true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Birmingham'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "foundedYear", "description", "logoUrl", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_cernh3', 'cernh3', 'CERN H3', 'cern-h3', 'CERN Hash House Harriers', 'Geneva', r.id, 'Switzerland',
  2026,
  'A new Hash House Harriers kennel at CERN, on the Geneva/France border, hashing since 2026. Trails start at CERN (Meyrin), with the odd hangover run in downtown Geneva.',
  '/kennel-logos/cernh3.avif',
  46.23372,
  6.05639,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Geneva'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes", "foundedYear", "description", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_ph3_sr', 'ph3-sr', 'Paramaribo H3', 'paramaribo-h3', 'Paramaribo Hash House Harriers', 'Paramaribo', r.id, 'Suriname',
  'Monday',
  '5:30 PM',
  'Weekly',
  'Weekly Monday evening run/walk; meets at a member''s house or a bar.',
  1989,
  'The Hash House Harriers of Paramaribo, Suriname — founded in 1989 by members of the Dutch embassy. A weekly Monday-evening run/walk that meets at a member''s house or a bar, finishing with the usual circle. On-on!',
  5.83503,
  -55.16703,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Paramaribo'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "hashCash", "description", "logoUrl", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_abujah3', 'abujah3', 'Abuja H3', 'abuja-h3', 'Abuja Hash House Harriers', 'Abuja', r.id, 'Nigeria',
  'Saturday',
  '2:30 PM',
  '₦3,000',
  'Abuja Hash House Harriers — the Hash House Harriers kennel of Nigeria''s Federal Capital Territory. ''A drinking club with a running problem,'' trailing around Abuja (Wuse and beyond). Run #816 as of October 2026.',
  '/kennel-logos/abujah3.png',
  9.0765,
  7.3986,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Abuja'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "logoUrl", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_blhhh', 'blhhh', 'Big Lik H3', 'big-lik-h3', 'Big Lik Hash House Harriers', 'Adana', r.id, 'Turkey',
  'Saturday',
  '5:00 PM',
  'Biweekly',
  '/kennel-logos/blhhh.avif',
  37.0017,
  35.4259,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Adana'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "scheduleNotes", "hashCash", "logoUrl", "latitude", "longitude", "createdAt", "updatedAt")
SELECT 'knl_hcnov_hannover_h3', 'hannover-h3', 'Hannover H3', 'hannover-h3', 'Hannover Hash House Harriers', 'Hannover', r.id, 'Germany',
  'Sunday',
  '12:00 PM',
  'Cadence unconfirmed (two Harrier Central runs so far); per-event dates and times come from Harrier Central.',
  '€5',
  '/kennel-logos/hannover-h3.png',
  52.3759,
  9.732,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Hannover'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleTime", "scheduleFrequency", "description", "logoUrl", "createdAt", "updatedAt")
SELECT 'knl_hcnov_mobh3', 'mobh3', 'Moon Over Barbados H3', 'moon-over-barbados-h3', 'Moon Over Barbados H3', 'Bridgetown', r.id, 'Barbados',
  '7:00 PM',
  'Monthly',
  'Moon Over Barbados H3 — the Barbados full-moon hash, running monthly on or near the full moon.',
  '/kennel-logos/mobh3.png',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Bridgetown'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleDayOfWeek", "scheduleTime", "description", "logoUrl", "createdAt", "updatedAt")
SELECT 'knl_hcnov_bbh3', 'bbh3', 'Barbados Bike H3', 'barbados-bike-h3', 'Barbados Bike H3', 'Bridgetown', r.id, 'Barbados',
  'Sunday',
  '6:00 AM',
  'Barbados Bike H3 — the Barbados bike hash (''bike bash''), a mountain-bike sibling of the Barbados Hash House Harriers, riding around Christ Church / Bridgetown, Barbados.',
  '/kennel-logos/bbh3.png',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Bridgetown'
ON CONFLICT ("kennelCode") DO NOTHING;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, "scheduleFrequency", "scheduleNotes", "hashCash", "description", "logoUrl", "latitude", "longitude", "dogFriendly", "createdAt", "updatedAt")
SELECT 'knl_hcnov_sunh3', 'sunh3', 'SUNH3', 'sunh3', 'Shenanagains Under Nightfall', 'Raleigh, NC', r.id, 'USA',
  'Monthly',
  'Monthly full-moon evening/night hash around the Raleigh/Triangle area (venues rotate — Raleigh, Cary, Burlington). Meet ~6:30 PM, circle ~7:00 PM. Run day tracks the full moon.',
  '$5',
  'Shenanagains Under Nightfall (SUNH3) is a Raleigh/Triangle full-moon night hash — a drinking club with a running problem that meets once a lunar month after dark.',
  '/kennel-logos/sunh3.avif',
  35.78,
  -78.64,
  true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r WHERE r.name = 'Raleigh, NC'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT v.id, k.id, v.alias
FROM (VALUES
    ('ka_hcnov_yh3_1', 'yh3', 'Yorkshire H3'),
    ('ka_hcnov_yh3_2', 'yh3', 'Yorkshire HHH'),
    ('ka_hcnov_yh3_3', 'yh3', 'Yorkshire Hash House Harriers'),
    ('ka_hcnov_yh3_4', 'yh3', 'Yorkshire'),
    ('ka_hcnov_oph3_1', 'oph3', 'Okinawa Poofters'),
    ('ka_hcnov_oph3_2', 'oph3', 'Okinawa Poofters H3'),
    ('ka_hcnov_oph3_3', 'oph3', 'Okinawa Poofters Hash House Harriers'),
    ('ka_hcnov_bdh3_uk_1', 'bdh3-uk', 'Black Death'),
    ('ka_hcnov_bdh3_uk_2', 'bdh3-uk', 'BD H3'),
    ('ka_hcnov_bdh3_uk_3', 'bdh3-uk', 'BDH3-UK'),
    ('ka_hcnov_bdh3_uk_4', 'bdh3-uk', 'Black Death Hash House Harriers'),
    ('ka_hcnov_da2b_1', 'da2b', 'Devon A2B'),
    ('ka_hcnov_da2b_2', 'da2b', 'Devon A to B'),
    ('ka_hcnov_da2b_3', 'da2b', 'Devon A 2 B'),
    ('ka_hcnov_bbch3_1', 'bbch3', 'Brum and Black Country H3'),
    ('ka_hcnov_bbch3_2', 'bbch3', 'Brum & Black Country H3'),
    ('ka_hcnov_bbch3_3', 'bbch3', 'Brum and Black Country Hash House Harriers'),
    ('ka_hcnov_cernh3_1', 'cernh3', 'CERN Hash'),
    ('ka_hcnov_cernh3_2', 'cernh3', 'CERN Hash House Harriers'),
    ('ka_hcnov_ph3_sr_1', 'ph3-sr', 'PH3-SR'),
    ('ka_hcnov_ph3_sr_2', 'ph3-sr', 'Paramaribo HHH'),
    ('ka_hcnov_ph3_sr_3', 'ph3-sr', 'Paramaribo Hash'),
    ('ka_hcnov_ph3_sr_4', 'ph3-sr', 'Paramaribo Hash House Harriers'),
    ('ka_hcnov_abujah3_1', 'abujah3', 'Abuja Hash'),
    ('ka_hcnov_abujah3_2', 'abujah3', 'Abuja HHH'),
    ('ka_hcnov_abujah3_3', 'abujah3', 'Abuja Hash House Harriers'),
    ('ka_hcnov_blhhh_1', 'blhhh', 'BLHHH'),
    ('ka_hcnov_blhhh_2', 'blhhh', 'Big Lik HHH'),
    ('ka_hcnov_blhhh_3', 'blhhh', 'Big Lik Hash House Harriers'),
    ('ka_hcnov_blhhh_4', 'blhhh', 'Incirlik Hash'),
    ('ka_hcnov_hannover_h3_1', 'hannover-h3', 'Hannover'),
    ('ka_hcnov_hannover_h3_2', 'hannover-h3', 'Hannover Hash House Harriers'),
    ('ka_hcnov_hannover_h3_3', 'hannover-h3', 'HANH3'),
    ('ka_hcnov_mobh3_1', 'mobh3', 'MOBH3'),
    ('ka_hcnov_mobh3_2', 'mobh3', 'Moon Over Barbados'),
    ('ka_hcnov_bbh3_1', 'bbh3', 'BBH3'),
    ('ka_hcnov_bbh3_2', 'bbh3', 'Barbados Bike'),
    ('ka_hcnov_bbh3_3', 'bbh3', 'Barbados Bike Hash'),
    ('ka_hcnov_sunh3_1', 'sunh3', 'Shenanagains Under Nightfall'),
    ('ka_hcnov_sunh3_2', 'sunh3', 'Shenanagains')
) AS v(id, kennel_code, alias)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Structured schedule rules (Pass-3 equivalent: HIGH confidence, SEED_DATA).
INSERT INTO "ScheduleRule" (id, "kennelId", rrule, "startTime", "anchorDate", confidence, source, "sourceReference", "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt")
SELECT v.id, k.id, v.rrule, v.start_time, v.anchor_date, 'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", v.source_ref, NOW() AT TIME ZONE 'UTC', true, v.label, v.display_order, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (VALUES
    ('sr_hcnov_yh3_1', 'yh3', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', '11:00', '2026-09-20', 'Fortnightly Sunday', 0, 'KennelSeed.scheduleRules[yh3]'),
    ('sr_hcnov_da2b_1', 'da2b', 'FREQ=MONTHLY;BYDAY=1SA', '12:30', NULL, 'First Saturday', 0, 'KennelSeed.scheduleRules[da2b]')
) AS v(id, kennel_code, rrule, start_time, anchor_date, label, display_order, source_ref)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Sources (all upcomingOnly:true — HC getEvents is future-only).
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_yh3', 'Yorkshire H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"5ee2d8ec-57a4-4461-ae5c-bcf0de3f4ce0","defaultKennelTag":"yh3","defaultTitle":"Yorkshire H3","staleTitleAliases":["Placeholder event for YH3","Yorkshire H3 Sunday"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_oph3', 'Okinawa Poofters Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"c4a54536-aa57-41b1-b487-f94db0fd2e71","defaultKennelTag":"oph3","defaultTitle":"Okinawa Poofters","upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_bdh3_uk', 'Black Death H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"92c77191-e7e4-47f6-99ac-b2b33dd80952","defaultKennelTag":"bdh3-uk","defaultTitle":"Black Death H3","staleTitleAliases":["Placeholder event for BD H3"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_da2b', 'Devon A2B Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"a3844c71-7a31-4ef7-a6e0-2444023182ac","defaultKennelTag":"da2b","defaultTitle":"Devon A2B","staleTitleAliases":["Devon A2B","Devon A2B.","Placeholder event for DA2B"],"titleStripPatterns":["^(?:devon a2b )?(?:hash|run) \\d+!?$"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_bbch3', 'Brum and Black Country H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"e369f74d-a523-4857-a03f-83112edc7e29","defaultKennelTag":"bbch3","defaultTitle":"Brum & Black Country H3","staleTitleAliases":["Placeholder event for BBCH3"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_cernh3', 'CERN H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"80886b52-cd7f-4a19-9285-1a94e2ce35d7","defaultKennelTag":"cernh3","defaultTitle":"CERN H3","staleTitleAliases":["Placeholder event for CERN H3"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_ph3_sr', 'Paramaribo H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"84d28394-1a47-42fb-828d-af322e22a497","defaultKennelTag":"ph3-sr","defaultTitle":"Paramaribo H3","staleTitleAliases":["Hash","Placeholder event for PH3"],"titleStripPatterns":["^run \\d+$"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_abujah3', 'Abuja H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"fa948a7e-c51f-4024-8e81-fb09c30977c1","defaultKennelTag":"abujah3","defaultTitle":"Abuja H3","staleTitleAliases":["Placeholder event for Abuja H3"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_blhhh', 'Big Lik H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"cdd3638f-b7e4-4759-84c8-d56552938176","defaultKennelTag":"blhhh","defaultTitle":"Big Lik H3 Trail","staleTitleAliases":["Description","Placeholder event for BLHHH"],"titleStripPatterns":["^un #\\d+[ -]*"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_hannover_h3', 'Hannover H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"254b7c83-06c8-4c27-ada4-13b3a1581ce2","defaultKennelTag":"hannover-h3","defaultTitle":"Hannover H3","staleTitleAliases":["Hannover H3"],"titleStripPatterns":["\\s+placeholder$"],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_mobh3', 'Moon Over Barbados H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"e035b47d-efcb-46da-bb2e-9d306f4c1102","defaultKennelTag":"mobh3","defaultTitle":"Moon Over Barbados H3","staleTitleAliases":["Placeholder event for MOBH3"],"titleStripPatterns":["^mobh3 "],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_bbh3', 'Barbados Bike H3 Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"1651097d-3b01-46af-9008-e641e9d4d4b4","defaultKennelTag":"bbh3","defaultTitle":"Barbados Bike H3","staleTitleAliases":["Placeholder event for BBH3"],"titleStripPatterns":["^bash "],"upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_hcnov_sunh3', 'Shenanagains Under Nightfall Harrier Central', 'https://harriercentralpublicapi.azurewebsites.net/api/PortalApi/', 'HARRIER_CENTRAL'::"SourceType",
  '{"publicKennelId":"d9d1e89a-f340-4ce8-83f2-43e43d7beba0","defaultKennelTag":"sunh3","defaultTitle":"Shenanagains Under Nightfall","upcomingOnly":true}'::jsonb,
  8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel links (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT v.id, s.id, k.id
FROM (VALUES
    ('sk_hcnov_yh3', 'Yorkshire H3 Harrier Central', 'yh3'),
    ('sk_hcnov_oph3', 'Okinawa Poofters Harrier Central', 'oph3'),
    ('sk_hcnov_bdh3_uk', 'Black Death H3 Harrier Central', 'bdh3-uk'),
    ('sk_hcnov_da2b', 'Devon A2B Harrier Central', 'da2b'),
    ('sk_hcnov_bbch3', 'Brum and Black Country H3 Harrier Central', 'bbch3'),
    ('sk_hcnov_cernh3', 'CERN H3 Harrier Central', 'cernh3'),
    ('sk_hcnov_ph3_sr', 'Paramaribo H3 Harrier Central', 'ph3-sr'),
    ('sk_hcnov_abujah3', 'Abuja H3 Harrier Central', 'abujah3'),
    ('sk_hcnov_blhhh', 'Big Lik H3 Harrier Central', 'blhhh'),
    ('sk_hcnov_hannover_h3', 'Hannover H3 Harrier Central', 'hannover-h3'),
    ('sk_hcnov_mobh3', 'Moon Over Barbados H3 Harrier Central', 'mobh3'),
    ('sk_hcnov_bbh3', 'Barbados Bike H3 Harrier Central', 'bbh3'),
    ('sk_hcnov_sunh3', 'Shenanagains Under Nightfall Harrier Central', 'sunh3')
) AS v(id, source_name, kennel_code)
JOIN "Source" s ON s.name = v.source_name AND s.type = 'HARRIER_CENTRAL'::"SourceType"
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 7. Report (NOTICE only — never RAISE, so an empty shadow DB still migrates).
DO $$
DECLARE n_kennels int; n_links int;
BEGIN
  SELECT count(*) INTO n_kennels FROM "Kennel" WHERE "kennelCode" IN ('yh3', 'oph3', 'bdh3-uk', 'da2b', 'bbch3', 'cernh3', 'ph3-sr', 'abujah3', 'blhhh', 'hannover-h3', 'mobh3', 'bbh3', 'sunh3');
  SELECT count(*) INTO n_links FROM "SourceKennel" WHERE id LIKE 'sk_hcnov_%';
  RAISE NOTICE 'hc-batch-nov: % of 13 kennels present, % of 13 source links present', n_kennels, n_links;
END $$;

COMMIT;

