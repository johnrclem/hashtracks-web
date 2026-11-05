-- Onboard three kennels from config-only sources:
--   malvern-h3  Malvern H3 (Worcestershire, UK)           ICAL_FEED  malvernhash.co.uk/hash-cal.ics
--   c2h3-gb     Cheltenham & Cotswold H3 (Gloucs, UK)     ICAL_FEED  c2h3.co.uk/c2h3-calendar.ics
--   bsh3-ch     Basel-Stadt H3 (Basel, Switzerland)       MEETUP     basel-stadt-hash-house-harriers-bsh3
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the regions,
-- kennels, aliases, sources, SourceKennel links and Basel's ScheduleRule are applied
-- here. prisma/seed-data/*.ts and src/lib/region.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. METRO regions, parented to their (already seeded) COUNTRY region.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT v.id, v.name, v.slug, v.country, 'METRO'::"RegionLevel", v.tz, v.abbrev,
       v.color, v.pin, v.lat, v.lng, p.id,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (
  VALUES
    ('rgn_malvern',   'Malvern',   'malvern',   'UK',          'Europe/London', 'MAL', 'bg-violet-100 text-violet-700', '#8b5cf6', 52.1101, -2.3265, 'United Kingdom'),
    ('rgn_cotswolds', 'Cotswolds', 'cotswolds', 'UK',          'Europe/London', 'COT', 'bg-violet-100 text-violet-700', '#8b5cf6', 51.8875, -1.7594, 'United Kingdom'),
    ('rgn_basel',     'Basel',     'basel',     'Switzerland', 'Europe/Zurich', 'BSL', 'bg-red-100 text-red-700',       '#b91c1c', 47.5596,  7.5886, 'Switzerland')
) AS v(id, name, slug, country, tz, abbrev, color, pin, lat, lng, parent_name)
JOIN "Region" p ON p.name = v.parent_name AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennels (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "logoUrl", "foundedYear", "hashCash", "dogFriendly", "walkersWelcome",
  "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime", "scheduleNotes",
  description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT v.id, v.code, v.short_name, v.slug, v.full_name, v.region, r.id, v.country,
       v.website, v.fb, v.logo, v.founded, v.cash, v.dogs, v.walkers,
       v.dow, v.freq, v.stime, v.notes, v.descr, v.lat, v.lng,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (
  VALUES
    ('knl_malvern_h3', 'malvern-h3', 'Malvern H3', 'malvern-h3', 'Malvern Hash House Harriers',
     'Malvern', 'UK', 'https://www.malvernhash.co.uk', 'https://www.facebook.com/groups/61731295743/',
     NULL, 1981, NULL, true, true, 'Tuesday', 'Weekly', '7:00 PM',
     'Weekly Tuesday, year-round. ON at 7:00 PM; runs last ~1–1½ h.',
     'Malvern H3 — a friendly, dog- and walker-friendly hash meeting every Tuesday evening at a pub within ~10 miles of Malvern, Worcestershire. Founded 31 March 1981 as a Bicester H3 offshoot. Trails are usually a Long (~4–5 mi) and a Short (~2–3 mi); runs last about 1–1½ hours.',
     52.1101, -2.3265),
    ('knl_c2h3_gb', 'c2h3-gb', 'Cheltenham & Cotswold H3', 'cheltenham-cotswold-h3', 'Cheltenham & Cotswold Hash House Harriers',
     'Cotswolds', 'UK', 'https://c2h3.co.uk', NULL,
     '/kennel-logos/c2h3-gb.png', 1981, NULL, NULL, true, 'Monday', 'Weekly', '7:00 PM',
     NULL,
     'A family-orientated, non-competitive social running club — ''a drinking club with a running problem'' — established 25 January 1981, running weekly through the towns, villages and countryside of Cheltenham and the Cotswolds (Gloucestershire, Worcestershire and Herefordshire). Monday evenings in summer, moving to Sunday daytimes in autumn/winter; first run free.',
     51.9, -2.08),
    ('knl_bsh3_ch', 'bsh3-ch', 'Basel-Stadt H3', 'basel-stadt-h3', 'Basel-Stadt Hash House Harriers',
     'Basel', 'Switzerland', NULL, NULL,
     NULL, NULL, 'CHF 5', NULL, true, 'Sunday', 'Monthly', '2:00 PM',
     NULL,
     'Basel''s international, English-speaking hash — a social running/walking group in the Basel tri-border area (CH/FR/DE). Monthly trails welcoming runners and walkers of all abilities.',
     47.5596, 7.5886)
) AS v(id, code, short_name, slug, full_name, region, country, website, fb, logo, founded, cash, dogs, walkers,
       dow, freq, stime, notes, descr, lat, lng)
JOIN "Region" r ON r.name = v.region
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare MH3 / MVH3 / C2H3 / BSH3 deliberately omitted — owned by other kennels).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT t.id, k.id, t.alias
FROM (
  VALUES
    ('ka_malvern_1', 'malvern-h3', 'Malvern Hash House Harriers'),
    ('ka_malvern_2', 'malvern-h3', 'Malvern H3'),
    ('ka_malvern_3', 'malvern-h3', 'Malvern HHH'),
    ('ka_c2h3gb_1',  'c2h3-gb',    'Cheltenham & Cotswold Hash House Harriers'),
    ('ka_c2h3gb_2',  'c2h3-gb',    'Cheltenham & Cotswold Hash'),
    ('ka_c2h3gb_3',  'c2h3-gb',    'Cheltenham Hash'),
    ('ka_c2h3gb_4',  'c2h3-gb',    'C2H3-GB'),
    ('ka_bsh3ch_1',  'bsh3-ch',    'Basel-Stadt H3'),
    ('ka_bsh3ch_2',  'bsh3-ch',    'Basel H3'),
    ('ka_bsh3ch_3',  'bsh3-ch',    'Basel Hash'),
    ('ka_bsh3ch_4',  'bsh3-ch',    'Basel-Stadt Hash House Harriers'),
    ('ka_bsh3ch_5',  'bsh3-ch',    'BSH3-CH')
) AS t(id, code, alias)
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Sources. All three are rolling windows, so upcomingOnly is REQUIRED (otherwise
--    reconcile cancels each run once it ages off the feed).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES
  ('src_malvern_h3_ical', 'Malvern H3 iCal Feed', 'https://www.malvernhash.co.uk/hash-cal.ics',
   'ICAL_FEED'::"SourceType",
   '{"defaultKennelTag": "malvern-h3", "upcomingOnly": true}'::jsonb,
   7, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('src_c2h3_gb_ical', 'Cheltenham & Cotswold H3 iCal Feed', 'https://c2h3.co.uk/c2h3-calendar.ics',
   'ICAL_FEED'::"SourceType",
   '{"defaultKennelTag": "c2h3-gb", "upcomingOnly": true, "locationOmitIfMatches": ["^TORCHLIT(?:-[^,]*)?$"]}'::jsonb,
   7, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('src_bsh3_ch_meetup', 'Basel-Stadt H3 Meetup', 'https://www.meetup.com/basel-stadt-hash-house-harriers-bsh3/',
   'MEETUP'::"SourceType",
   '{"upcomingOnly": true, "groupUrlname": "basel-stadt-hash-house-harriers-bsh3", "kennelTag": "bsh3-ch", "extractRunNumber": true, "anchorTrailRunNumber": true}'::jsonb,
   7, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel links (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT t.id, s.id, k.id
FROM (
  VALUES
    ('sk_malvern_h3_ical', 'Malvern H3 iCal Feed',               'ICAL_FEED', 'malvern-h3'),
    ('sk_c2h3_gb_ical',    'Cheltenham & Cotswold H3 iCal Feed', 'ICAL_FEED', 'c2h3-gb'),
    ('sk_bsh3_ch_meetup',  'Basel-Stadt H3 Meetup',              'MEETUP',    'bsh3-ch')
) AS t(id, source_name, source_type, code)
JOIN "Source" s ON s.name = t.source_name AND s.type::text = t.source_type
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 6. Basel's authoritative schedule rule (monthly, 2nd Sunday 14:00). Same
--    (kennelId, rrule, source) key the seed's Pass-3 backfill would write.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_bsh3_ch_2su', k.id, 'FREQ=MONTHLY;BYDAY=2SU', '14:00',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource",
       'KennelSeed.scheduleRules[bsh3-ch]', NOW() AT TIME ZONE 'UTC', true, '2nd Sunday', 0,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'bsh3-ch'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

COMMIT;
