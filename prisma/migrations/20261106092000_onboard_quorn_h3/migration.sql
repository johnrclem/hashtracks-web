-- Onboard Quorn H3 (quorn-h3, quornh3.org.uk) — East Midlands kennel founded
-- 1987; monthly, 1st Sunday 11:00 since January 2026.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the kennel,
-- its aliases, schedule rule, the run-log source and the SourceKennel link are
-- applied here. The "East Midlands" region already exists (Mickleover H3).
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_quorn_h3', 'quorn-h3', 'Quorn H3', 'quorn-h3', 'Quorn Hash House Harriers',
  'East Midlands', r.id, 'UK',
  'http://www.quornh3.org.uk/', 'https://www.facebook.com/groups/quornh3',
  'Sunday', 'Monthly', '11:00 AM', 1987, true, '/kennel-logos/quorn-h3.png',
  'A drinking club with a running problem — Quorn H3 runs for fun in the countryside between Nottingham, Derby and Leicester. Founded 1987; flour-marked trails of about an hour, followed by a circle and a pint.',
  52.741, -1.174,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'East Midlands'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_quornh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'QH3'), (2, 'Quorn Hash'), (3, 'Quorn Hash House Harriers'), (4, 'Quorn HHH'))
       AS t(n, alias)
WHERE k."kennelCode" = 'quorn-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Schedule rule (Vercel never seeds, so scheduleRules go inline).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt"
)
SELECT
  'sr_quorn_h3_1su', k.id, 'FREQ=MONTHLY;BYDAY=1SU', '11:00', 'MEDIUM'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[quorn-h3]',
  NOW() AT TIME ZONE 'UTC', true, '1st Sunday', 0,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."kennelCode" = 'quorn-h3'
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 4. Source. Per-year XML ages out at the year boundary → upcomingOnly so
--    reconcile never cancels past runs (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_quorn_h3_runlog', 'Quorn H3 Runlog XML', 'http://www.quornh3.org.uk/runlog.html',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_quorn_h3_runlog', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Quorn H3 Runlog XML' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'quorn-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
