-- Onboard Donnington H3 (donnington-h3, donningtonh3.co.uk) — Telford,
-- Shropshire; founded 1976, the third UK hash. Weekly, seasonal: Monday 18:30
-- in summer, Sunday 11:00 in winter.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Shropshire region, the kennel, its aliases, seasonal schedule rules, the
-- website source and the SourceKennel link are applied here.
-- src/lib/region.ts and prisma/seed-data/{kennels,aliases,sources}.ts carry
-- the same rows. Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Shropshire METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_shropshire_uk', 'Shropshire', 'shropshire', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'SHR', 'bg-violet-100 text-violet-700', '#8b5cf6',
  52.6784, -2.4453, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "hashCash", "foundedYear", founder, "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_donnington_h3', 'donnington-h3', 'Donnington H3', 'donnington-h3',
  'Donnington Hash House Harriers', 'Shropshire', r.id, 'UK',
  'https://www.donningtonh3.co.uk/', 'https://www.facebook.com/Dh3running/',
  'Monday', 'Weekly', '6:30 PM', '£2', 1976, 'Ray Thornton',
  '/kennel-logos/donnington-h3.jpg',
  'A Drinking Club with a Running Problem. Donnington Hash House Harriers (DH3), founded 1976 at the Army Ordnance Depot in Donnington, Telford — the third Hash founded in the UK. Weekly trails across Shropshire: Monday evenings in summer, Sunday mornings in winter.',
  52.6784, -2.4453,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Shropshire'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "DH3" omitted — Dublin/Denver/Dallas/Dayton/Desert collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_donningtonh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Donnington Hash'), (2, 'Donnington HHH'), (3, 'DH3 Telford'),
             (4, 'Donnington Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'donnington-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Seasonal schedule rules (Vercel never seeds, so scheduleRules go inline).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  v.id, k.id, v.rrule, v.start_time, 'MEDIUM'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[donnington-h3]',
  NOW() AT TIME ZONE 'UTC', true, v.label, v.valid_from, v.valid_until, v.display_order,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (
  VALUES
    ('sr_donnington_h3_summer', 'FREQ=WEEKLY;BYDAY=MO', '18:30', 'Summer', '04-01', '09-30', 0),
    ('sr_donnington_h3_winter', 'FREQ=WEEKLY;BYDAY=SU', '11:00', 'Winter', '10-01', '03-31', 1)
) AS v(id, rrule, start_time, label, valid_from, valid_until, display_order)
JOIN "Kennel" k ON k."kennelCode" = 'donnington-h3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 5. Source. Rolling forward table → upcomingOnly so reconcile never cancels
--    runs that age off the homepage (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_donnington_h3_website', 'Donnington H3 Website', 'https://www.donningtonh3.co.uk/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 6. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_donnington_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Donnington H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'donnington-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
