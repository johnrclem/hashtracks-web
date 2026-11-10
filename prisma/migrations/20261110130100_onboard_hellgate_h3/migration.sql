-- Onboard Hellgate H3 (hellgate-h3, missoulahash.org) — monthly Saturday hash
-- in Missoula, first run 30 Sep 2002. HashTracks' first Montana kennel: adds the
-- "Montana" STATE_PROVINCE (under United States) and the "Missoula, MT" METRO.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- regions, the kennel, its aliases, its schedule rule, the website source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: Montana STATE_PROVINCE → United States; Missoula, MT METRO → Montana.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_montana', 'Montana', 'montana', 'USA', 'STATE_PROVINCE'::"RegionLevel",
  'America/Denver', 'MT', 'bg-teal-200 text-teal-800', '#0d9488',
  47.38, -109.64, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United States' AND p.level = 'COUNTRY'::"RegionLevel"
ON CONFLICT (name) DO NOTHING;

INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_missoula_mt', 'Missoula, MT', 'missoula-mt', 'USA', 'METRO'::"RegionLevel",
  'America/Denver', 'MSO', 'bg-teal-100 text-teal-700', '#14b8a6',
  46.87, -114, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'Montana'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "logoUrl",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "foundedYear", "hashCash", "dogFriendly", "walkersWelcome", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_hellgate_h3', 'hellgate-h3', 'Hellgate H3', 'hellgate-h3', 'Missoula Hellgate Hash House Harriers',
  'Missoula, MT', r.id, 'USA',
  'https://www.missoulahash.org', 'https://www.facebook.com/groups/50040467745', '/kennel-logos/hellgate-h3.jpg',
  'Saturday', '3:30 PM', 'Monthly',
  'Mostly the 3rd Saturday of the month; start times vary, roughly 12–4 pm.',
  2002, '$5', true, true,
  'Missoula, Montana''s Hash House Harriers: a drinking club with a running problem. Hellgate meets monthly, mostly on the 3rd Saturday, for a hounds-versus-hares trail around town or up into the mountains. Annual favorites include a Red Dress Run and a summer campout. No running experience needed; virgins and visiting hashers are welcome.',
  46.87, -114,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Missoula, MT'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "MH3"/"HH3"/"HHH" omitted — taken or collision-prone).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_hellgate_h3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Hellgate H3'), (2, 'Hellgate HHH'), (3, 'Hellgate Hash'),
             (4, 'Hellgate Hash House Harriers'), (5, 'Missoula H3'), (6, 'Missoula Hash'),
             (7, 'Missoula Hellgate H3'), (8, 'Missoula Hellgate Hash House Harriers'),
             (9, 'Hellgate (Missoula) H3'))
       AS t(n, alias)
WHERE k."kennelCode" = 'hellgate-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Schedule rule (seed `scheduleRules`; Vercel never seeds, so it goes inline).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT
  'sr_hellgate_h3_1', k.id, 'FREQ=MONTHLY;BYDAY=3SA', 'MEDIUM'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[hellgate-h3]',
  NOW() AT TIME ZONE 'UTC', true, '3rd Saturday (usual)', 0,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'hellgate-h3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Past runs arrive through the one-shot backfill; upcomingOnly clamps
--    reconcile to the future so they're never cancelled.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_hellgate_h3_website', 'Hellgate H3 Website', 'https://www.missoulahash.org',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hellgate_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Hellgate H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'hellgate-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
