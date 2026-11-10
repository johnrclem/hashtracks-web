-- Onboard Agana H3 (ah3-gu, guamhash.com) — weekly Saturday 16:00 hash, the
-- original Guam hash (founded 1981). HashTracks' first Guam kennel: adds "Guam"
-- as a single COUNTRY-level region (Singapore precedent, no METRO).
--
-- Source: config-only STATIC_SCHEDULE (FREQ=WEEKLY;BYDAY=SA), anchored to run
-- #2317 on 2026-11-07 from the kennel's live Receding Hareline table.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`. Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Guam COUNTRY (top level, no parent).
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES (
  'rgn_guam', 'Guam', 'guam', 'Guam', 'COUNTRY'::"RegionLevel",
  'Pacific/Guam', 'GU', 'bg-pink-100 text-pink-700', '#db2777',
  13.4443, 144.7937, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "logoUrl", "foundedYear", "hashCash", "dogFriendly",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_ah3_gu', 'ah3-gu', 'Agana H3', 'agana-h3', 'Agana Hash House Harriers',
  'Guam', r.id, 'Guam',
  'https://www.guamhash.com', '/kennel-logos/ah3-gu.png', 1981, '$10', false,
  'Saturday', '4:00 PM', 'Weekly',
  'The original Guam hash and Mother Hash of Micronesia, founded 1981 — Guam''s Worst Drinking Club, drinkers with a running problem. A-to-B ''live'' trails through jungle, swamp, mountain, river and coastline every Saturday.',
  13.4732, 144.7528,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Guam'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "AH3" omitted — Austin/Aloha/Amsterdam/Adelaide/Auckland share it).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_ah3_gu_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Agana H3'), (2, 'Agana Hash House Harriers'), (3, 'Guam Hash'), (4, 'AH3 Guam'))
       AS t(n, alias)
WHERE k."kennelCode" = 'ah3-gu'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source: weekly Saturday static schedule.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_ah3_gu_static', 'Agana H3 Static Schedule', 'https://www.guamhash.com',
  'STATIC_SCHEDULE'::"SourceType",
  '{"kennelTag": "ah3-gu", "rrule": "FREQ=WEEKLY;BYDAY=SA", "anchorDate": "2026-11-07", "startRunNumber": 2317, "startTime": "16:00", "defaultLocation": "PDN building, Hagåtña", "defaultDescription": "Every Saturday: 3:45pm show, map posted at 4:00pm, at the PDN (Pacific Daily News) building in Hagåtña. $10 for beer & snacks, $1 for gloves. Hares and run themes are on https://www.guamhash.com/recedinghareline"}'::jsonb,
  5, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. Schedule rule, as scripts/backfill-schedule-rules.ts Pass 1 would derive it
--    from the STATIC_SCHEDULE source (that script isn't run on deploy).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "isActive", "displayOrder", "createdAt", "updatedAt"
)
SELECT
  'sr_ah3_gu_1', k.id, 'FREQ=WEEKLY;BYDAY=SA', '2026-11-07', '16:00', 'HIGH'::"ScheduleConfidence",
  'STATIC_SCHEDULE'::"ScheduleRuleSource", 'https://www.guamhash.com',
  true, 0, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'ah3-gu'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 6. SourceKennel link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_ah3_gu_static', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Agana H3 Static Schedule' AND s.type = 'STATIC_SCHEDULE'::"SourceType"
  AND k."kennelCode" = 'ah3-gu'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
