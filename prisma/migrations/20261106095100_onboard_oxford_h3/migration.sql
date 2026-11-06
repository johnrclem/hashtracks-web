-- Onboard Oxford H3 (oxford-h3, oxfordh3.org.uk) — Wednesday 19:00 kennel
-- founded 1999 (Bicester H3 offshoot); weekly in summer, fortnightly in winter.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Oxford region, the kennel, its aliases, seasonal schedule rules, the website
-- source and the SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Oxford METRO under United Kingdom (distinct from Bicester).
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_oxford_uk', 'Oxford', 'oxford', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'OXF', 'bg-violet-100 text-violet-700', '#8b5cf6',
  51.752, -1.2577, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "instagramHandle", "twitterHandle",
  "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime", "scheduleNotes",
  "hashCash", "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_oxford_h3', 'oxford-h3', 'Oxford H3', 'oxford-h3', 'Oxford Hash House Harriers',
  'Oxford', r.id, 'UK',
  'https://www.oxfordh3.org.uk', 'https://www.facebook.com/groups/oxfordh3/', 'oxfordh3', 'oxfordh3',
  'Wednesday', 'Weekly', '7:00 PM',
  'Wednesday 7:00 PM. Weekly from April to mid-October; fortnightly over the winter.',
  '£4 (first 3 runs free); food and beer provided', 1999, true, '/kennel-logos/oxford-h3.gif',
  'Oxford Hash House Harriers — ''a drinking club with a running problem'', founded 6 October 1999 as a Bicester H3 offshoot. The self-styled ''Odd Sock Hash'' (motto Poto Ergo Curro) runs on Wednesday evenings at 7 p.m. on flour trails across Oxford and the Oxfordshire countryside — weekly in summer, fortnightly in winter — finishing with a beer stop, food and a circle. Newcomers welcome; first three runs free, then £4.',
  51.752, -1.2577,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Oxford'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "OH3" omitted — Oregon/Ottawa/Oslo collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_oxfordh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Oxford Hash'), (2, 'Oxford HHH'), (3, 'OxfordH3'), (4, 'Oxford Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'oxford-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Seasonal schedule rules (Vercel never seeds, so scheduleRules go inline).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  v.id, k.id, v.rrule, v.anchor_date, '19:00', 'MEDIUM'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[oxford-h3]',
  NOW() AT TIME ZONE 'UTC', true, v.label, v.valid_from, v.valid_until, v.display_order,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (
  VALUES
    ('sr_oxford_h3_summer', 'FREQ=WEEKLY;BYDAY=WE', NULL, 'Summer (weekly)', '04-01', '10-15', 0),
    ('sr_oxford_h3_winter', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', '2026-11-04', 'Winter (fortnightly)', '10-16', '03-31', 1)
) AS v(id, rrule, anchor_date, label, valid_from, valid_until, display_order)
JOIN "Kennel" k ON k."kennelCode" = 'oxford-h3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Rolling Hash Diary → upcomingOnly so reconcile never cancels runs
--    that move to the archive page (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_oxford_h3_website', 'Oxford H3 Website', 'https://www.oxfordh3.org.uk/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_oxford_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Oxford H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'oxford-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
