-- Onboard Hill Country H3 (hch3) + sister full-moon kennel Heart of Texas H3
-- (hoth3) — Killeen / Fort Cavazos / Temple / Belton, TX. First central-Texas
-- coverage. Adds the "Killeen, TX" METRO under the existing Texas
-- STATE_PROVINCE.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: METRO "Killeen, TX" → parent STATE_PROVINCE "Texas".
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "createdAt", "updatedAt"
)
VALUES ('rgn_killeen_tx', 'Killeen, TX', 'killeen-tx', 'USA', 'METRO'::"RegionLevel", 'America/Chicago', 'KIL',
        'bg-lime-100 text-lime-700', '#65a30d', 31.12, -97.73,
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name) DO NOTHING;

UPDATE "Region" m
SET "parentId" = s.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" s
WHERE m.name = 'Killeen, TX' AND s.name = 'Texas' AND s.level = 'STATE_PROVINCE'::"RegionLevel"
  AND m."parentId" IS DISTINCT FROM s.id;

-- 2. Kennels.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency",
  "scheduleNotes", "foundedYear", "logoUrl", description, "createdAt", "updatedAt"
)
SELECT t.id, t.code, t.short, t.slug, t.fname, 'Killeen, TX', r.id, 'USA',
       t.website, t.fb, t.dow, t.stime, t.freq, t.notes, t.founded, t.logo, t.descr,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r,
     (VALUES
       ('knl_hch3', 'hch3', 'Hill Country H3', 'hill-country-h3', 'Hill Country Hash House Harriers',
        'https://hch3.net', 'https://www.facebook.com/groups/HillCountryH3/',
        'Saturday', '2:00 PM', 'Biweekly',
        'Every other Saturday at 2 PM, year-round, around Killeen / Fort Cavazos / Temple / Belton.',
        2001, '/kennel-logos/hch3.png',
        'Every-other-Saturday 2 PM hash around Killeen, Fort Cavazos, Temple and Belton (Bell & Coryell Counties), founded in Temple in February 2001. Sister kennel Heart of Texas H3 runs the full-moon trails.'),
       ('knl_hoth3', 'hoth3', 'Heart of Texas H3', 'heart-of-texas-h3', 'Heart of Texas Hash House Harriers',
        'https://hch3.net/heart_of_texas_h3.htm', 'https://www.facebook.com/groups/HOTH3/',
        'Friday', '7:30 PM', 'Full Moon',
        'Friday nearest the full moon, 7:30 PM.',
        1991, '/kennel-logos/hoth3.png',
        'Full-moon hash for the Killeen / Belton / Harker Heights area, running on the Friday nearest each full moon at 7:30 PM since June 1991. Sister kennel of Hill Country H3.'))
       AS t(id, code, short, slug, fname, website, fb, dow, stime, freq, notes, founded, logo, descr)
WHERE r.name = 'Killeen, TX'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_' || t.code || '_' || t.n, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES
        ('hch3', 1, 'Hill Country H3'), ('hch3', 2, 'HCH3'), ('hch3', 3, 'Hill Country Hash'),
        ('hch3', 4, 'Hill Country Hash House Harriers'),
        ('hoth3', 1, 'Heart of Texas H3'), ('hoth3', 2, 'HOTH3'), ('hoth3', 3, 'HOT H3'),
        ('hoth3', 4, 'Heart of Texas Hash'), ('hoth3', 5, 'Heart of Texas Hash House Harriers'))
       AS t(code, n, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. HCH3 biweekly-Saturday schedule rule (seed `scheduleRules`). HOTH3 is
--    full-moon (Pass-2 FREQ=LUNAR from scheduleFrequency) — no rule.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_hch3_1', k.id, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '2026-11-14', '14:00',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[hch3]',
       NOW() AT TIME ZONE 'UTC', true, 'Biweekly Saturday', 0,
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'hch3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Sources: the live shared calendar + a disabled backfill-provenance
--    archive row (scripts/backfill-hch3-history.ts binds to it).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES
  ('src_hch3_gcal', 'Hill Country H3 Google Calendar',
   'i98lot5sfibirmdp9kjp8jn604@group.calendar.google.com', 'GOOGLE_CALENDAR'::"SourceType",
   '{"kennelPatterns": [["^Heart of Texas\\b|^HOTH3\\b|^HOT Humpin", "hoth3"], ["^Hill Country\\b|^HCH3\\b", "hch3"]], "strictKennelRouting": true, "skipPatterns": ["Miss Management", "Pub Call"], "futureHorizonDays": 100}'::jsonb,
   8, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'),
  ('src_hch3_archive', 'Hill Country H3 Calendar Archive',
   'i98lot5sfibirmdp9kjp8jn604@group.calendar.google.com', 'GOOGLE_CALENDAR'::"SourceType",
   '{"upcomingOnly": true}'::jsonb,
   7, 'weekly', 90, false, 'UNKNOWN'::"SourceHealth",
   NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel links (both sources → both kennels).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_' || s.id || '_' || k."kennelCode", s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name IN ('Hill Country H3 Google Calendar', 'Hill Country H3 Calendar Archive')
  AND s.type = 'GOOGLE_CALENDAR'::"SourceType"
  AND k."kennelCode" IN ('hch3', 'hoth3')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
