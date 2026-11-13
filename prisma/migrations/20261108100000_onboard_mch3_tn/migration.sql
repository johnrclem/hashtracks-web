-- Onboard Music City H3 (mch3-tn) — Nashville, TN. Region "Nashville, TN" already
-- exists (shared with bushwhackersh3).
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent (ON CONFLICT on
-- natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "logoUrl", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
  "scheduleNotes", "hashCash", "foundedYear", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT 'knl_mch3_tn', 'mch3-tn', 'Music City H3', 'music-city-h3',
       'Music City Hash House Harriers', 'Nashville, TN', r.id, 'USA',
       'https://musiccityhash.com',
       'https://musiccityhash.com/wp-content/uploads/2024/11/cropped-OGLogoTran-1.png',
       'Saturday', '2:00 PM', 'Biweekly',
       '1st, 3rd & 5th Saturdays (usually 2 PM), plus full moons and specials. Annual DELIVERANCE campout the 3rd weekend in July.',
       '$5', 1991,
       'Nashville''s original hash, running since June 1991. Saturday-afternoon trails on the 1st, 3rd and 5th Saturdays, plus full moons and the annual Deliverance campout in July. Adults 21+ only.',
       36.16, -86.78,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Nashville, TN'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Aliases. Bare "MCH3" is Mexico City H3's.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_mch3_tn_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Music City H3'), (2, 'Music City Hash'), (3, 'Music City Hash House Harriers'),
             (4, 'Music City (Nashville) H3'), (5, 'MCH3 Nashville'), (6, 'Nashville H3'))
       AS t(n, alias)
WHERE k."kennelCode" = 'mch3-tn'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Schedule rules (seed `scheduleRules`): one per ordinal, because parseRRule
--    rejects a multi-ordinal BYDAY list.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_mch3_tn_' || t.n, k.id, t.rrule, '14:00',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[mch3-tn]',
       NOW() AT TIME ZONE 'UTC', true, t.label, t.ord,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k,
     (VALUES (1, 'FREQ=MONTHLY;BYDAY=1SA', '1st Saturday', 0),
             (2, 'FREQ=MONTHLY;BYDAY=3SA', '3rd Saturday', 1),
             (3, 'FREQ=MONTHLY;BYDAY=5SA', '5th Saturday', 2))
       AS t(n, rrule, label, ord)
WHERE k."kennelCode" = 'mch3-tn'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 4. Source: forward-only Tribe feed, so upcomingOnly is REQUIRED (the adapter
--    refuses to run without it). History comes from scripts/backfill-mch3-tn-history.ts.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_mch3_tn_tribe', 'Music City H3 Events Calendar', 'https://musiccityhash.com',
  'HTML_SCRAPER'::"SourceType",
  '{"tribeEvents": true, "kennelTag": "mch3-tn", "upcomingOnly": true, "runNumberFromTitle": true, "defaultStartTime": "14:00"}'::jsonb,
  8, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_' || s.id || '_mch3_tn', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Music City H3 Events Calendar'
  AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'mch3-tn'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
