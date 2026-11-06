-- Onboard North Hants H4 (nh4, nh4.org) — Aldershot-area kennel founded 1981;
-- Sunday runs roughly every other week. Runs come from the published Google
-- Sheet CSV behind the site's run-list embed (config-only GOOGLE_SHEETS source).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Aldershot region, the kennel, its aliases, the sheet source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Aldershot METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_aldershot_uk', 'Aldershot', 'aldershot', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'ALD', 'bg-violet-100 text-violet-700', '#8b5cf6',
  51.2483, -0.7594, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "hashCash", "foundedYear", "dogFriendly", "walkersWelcome", "logoUrl",
  description, "createdAt", "updatedAt"
)
SELECT
  'knl_nh4', 'nh4', 'North Hants H4', 'north-hants-h4', 'North Hants Hash House Harriers',
  'Aldershot', r.id, 'UK',
  'https://www.nh4.org', 'https://www.facebook.com/groups/121837721191777/',
  'Sunday', 'Biweekly', '11:00 AM',
  'Sundays, roughly every other week (run list) — 11:00 AM in winter, 6:00 PM in summer. As of 2026 the club also adds occasional pop-up runs.',
  '£1 (first run free); £30/yr membership', 1981, true, true, '/kennel-logos/nh4.png',
  'North Hants Hash House Harriers (NH4) — a non-competitive trail-running ''drinking club with a running problem'' founded on Good Friday 1981 in Aldershot. Trails run within OS Map 186 (Aldershot & Guildford), followed by drinks at a nearby pub.',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Aldershot'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_nh4_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'North Hants Hash House Harriers'), (2, 'North Hants H3'), (3, 'North Hants Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'nh4'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source (config-only GOOGLE_SHEETS over the published run-list CSV).
--    Forward list → upcomingOnly so reconcile never cancels runs that move to
--    the "past runs" tab (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_nh4_run_list_sheet', 'North Hants H4 Run List Sheet', 'https://www.nh4.org/run-list-data/run-list',
  'GOOGLE_SHEETS'::"SourceType",
  '{"sheetId": "anonymous", "csvUrl": "https://docs.google.com/spreadsheets/d/e/2PACX-1vTHqOFTR_N3_rOVblYaZAilWMnDij-TUWKh6JI0VI_XNde_hmgRjSUx62R1EFjR68n7vUYi_Z5HdRcx/pub?gid=0&single=true&output=csv", "columns": {"runNumber": 0, "date": 1, "startTime": 2, "hares": 3, "location": 4, "address": 5, "description": 8}, "kennelTagRules": {"default": "nh4"}, "upcomingOnly": true}'::jsonb,
  7, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_nh4_run_list_sheet', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'North Hants H4 Run List Sheet' AND s.type = 'GOOGLE_SHEETS'::"SourceType"
  AND k."kennelCode" = 'nh4'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
