-- Onboard Chichester H3 (ch3-gb, chihhh.org.uk) — fortnightly Sunday hash in West
-- Sussex, est. 1983. Source: the kennel's own iCal feed, parsed with the new
-- `summaryGridRefVenue` mode of the shared ICalAdapter (hares/venue are packed
-- into the SUMMARY around an OS grid reference).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the region,
-- kennel, aliases, source, SourceKennel link and ScheduleRule are applied here.
-- prisma/seed-data/*.ts and src/lib/region.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Chichester METRO region, parented to United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT 'rgn_chichester', 'Chichester', 'chichester', 'UK', 'METRO'::"RegionLevel",
       'Europe/London', 'CIC', 'bg-violet-100 text-violet-700', '#8b5cf6',
       50.8365, -0.7792, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel (region resolved by name).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "logoUrl", "foundedYear", "hashCash", "dogFriendly", "walkersWelcome",
  "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_ch3_gb', 'ch3-gb', 'Chichester H3', 'chichester-h3', 'Chichester Hash House Harriers',
  'Chichester', r.id, 'UK',
  'https://www.chihhh.org.uk', 'https://www.facebook.com/chichesterhhh', '/kennel-logos/ch3-gb.avif',
  1983, 'Free', true, true,
  'Sunday', 'Biweekly', '11:00 AM',
  'Chichester Hash House Harriers — a small group of runners and walkers hashing the South West Sussex and South East Hampshire countryside on alternate Sundays. Flour trails, a loose set of rules, a pub afterwards. Visitors, walkers and dogs welcome; it''s free.',
  50.8365, -0.7792, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Chichester'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "CH3" omitted — Chicago H3 owns it).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_ch3gb_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Chichester H3'), (2, 'Chichester Hash House Harriers'), (3, 'CHIHHH')) AS t(n, alias)
WHERE k."kennelCode" = 'ch3-gb'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Rolling ~2-year window, so upcomingOnly is REQUIRED.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_ch3_gb_ical', 'Chichester H3 iCal Feed', 'https://www.chihhh.org.uk/diary',
  'ICAL_FEED'::"SourceType",
  '{"defaultKennelTag": "ch3-gb", "upcomingOnly": true, "runNumberPatterns": ["Run (\\d+)\\b"], "summaryGridRefVenue": true}'::jsonb,
  7, 'daily', 1095, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_ch3_gb_ical', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Chichester H3 iCal Feed' AND s.type = 'ICAL_FEED'::"SourceType"
  AND k."kennelCode" = 'ch3-gb'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 6. Schedule rule: alternate Sundays 11:00, anchored on Run 1096 (2026-10-18)
--    so INTERVAL=2 has the right phase.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_ch3_gb_alt_su', k.id, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', '2026-10-18', '11:00',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource",
       'KennelSeed.scheduleRules[ch3-gb]', NOW() AT TIME ZONE 'UTC', true, 'Alternate Sundays', 0,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'ch3-gb'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

COMMIT;
