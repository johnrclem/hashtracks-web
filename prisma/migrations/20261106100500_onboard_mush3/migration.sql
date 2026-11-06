-- Onboard Muscateers H3 (mush3) — first 🇴🇲 Oman kennel (Muscat, first meet 1 Sep 2023).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Oman/Muscat regions, the kennel, its aliases, its fortnightly schedule rule,
-- the source and the SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Regions: COUNTRY "Oman" → METRO "Muscat".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES
  ('rgn_oman', 'Oman', 'oman', 'Oman', 'COUNTRY'::"RegionLevel", 'Asia/Muscat', 'OM',
   'bg-rose-200 text-rose-800', '#e11d48', 21.4735, 55.9754,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('rgn_muscat_om', 'Muscat', 'muscat', 'Oman', 'METRO'::"RegionLevel", 'Asia/Muscat', 'MCT',
   'bg-rose-100 text-rose-700', '#f43f5e', 23.588, 58.3829,
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c
WHERE m.name = 'Muscat' AND c.name = 'Oman' AND c.level = 'COUNTRY'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM c.id;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "instagramHandle", "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "dogFriendly", "walkersWelcome", "logoUrl", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_mush3', 'mush3', 'Muscateers H3', 'muscateers-h3', 'Muscateers Hash House Harriers',
  'Muscat', r.id, 'Oman', 'https://muscateersh3.com/', 'muscateers_hash_house_harriers',
  'Friday', 'Biweekly', 'Every second Friday, late afternoon. All meets require prior registration.',
  'BYOB', 2023, true, true, '/kennel-logos/mush3.png',
  'A small, family-friendly hash in Muscat, Oman, meeting every second Friday late in the afternoon with the emphasis on Fun, Friendship and Fitness. Non-competitive urban, beach and wadi trails for walkers and runners; BYOB, prior registration required. Revived in 2023 from Muscat Streetstalkers H3.',
  23.588, 58.3829, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Muscat'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_mush3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'MusH3'), (2, 'Muscateers'), (3, 'Muscateers H3'), (4, 'Muscateers Hash'),
             (5, 'Muscateers Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'mush3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Fortnightly schedule rule (seed `scheduleRules`; anchored on meet #77).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_mush3_1', k.id, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR', '2026-08-28',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[mush3]',
       NOW() AT TIME ZONE 'UTC', true, 'Fortnightly Friday', 0,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'mush3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Both pages rewrite/drop rows, so upcomingOnly is REQUIRED.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_mush3_hareline', 'Muscateers H3 Website Hareline',
  'https://muscateersh3.com/mush3-meets/receding-hareline/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 1200, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_mush3_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Muscateers H3 Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'mush3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
