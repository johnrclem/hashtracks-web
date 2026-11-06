-- Onboard Cambridge H3 (cambridge-h3, www.ch3.co.uk) — weekly Sunday 11:00
-- Cambridgeshire kennel founded 1978. The site is a Blazor SPA, scraped via
-- the NAS browser-render service.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Cambridge region, the kennel, its aliases, the website source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Cambridge METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_cambridge_uk', 'Cambridge', 'cambridge', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'CAM', 'bg-violet-100 text-violet-700', '#8b5cf6',
  52.2053, 0.1218, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "hashCash", "foundedYear", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_cambridge_h3', 'cambridge-h3', 'Cambridge H3', 'cambridge-h3',
  'Cambridge Hash House Harriers', 'Cambridge', r.id, 'UK',
  'https://www.ch3.co.uk/', 'Sunday', 'Weekly', '11:00 AM',
  '£3 (first run free)', 1978, '/kennel-logos/cambridge-h3.gif',
  'A drinking club with a running problem — a non-competitive Sunday-morning run around the Cambridgeshire countryside at 11am, followed by a beer in a local pub. First run free.',
  52.2053, 0.1218,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Cambridge'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "CH3" omitted — Chicago/Charlotte/Charleston/Copenhagen collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_cambridgeh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Cambridge Hash House Harriers'), (2, 'Cambridge Hash'), (3, 'Cambridge HHH'))
       AS t(n, alias)
WHERE k."kennelCode" = 'cambridge-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Rolling ~7-run homepage window → upcomingOnly so reconcile never
--    cancels runs that age off (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_cambridge_h3_website', 'Cambridge H3 Website', 'https://www.ch3.co.uk/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_cambridge_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Cambridge H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'cambridge-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
