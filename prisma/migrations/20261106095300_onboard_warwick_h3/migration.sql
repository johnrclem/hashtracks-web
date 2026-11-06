-- Onboard Warwick H3 (warwick-h3, warwickhash.org.uk) — weekly Monday 19:00
-- kennel meeting at pubs within ~10 miles of Warwick.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Warwick region, the kennel, its aliases, the website source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Warwick METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_warwick_uk', 'Warwick', 'warwick', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'WRW', 'bg-violet-100 text-violet-700', '#8b5cf6',
  52.2823, -1.5849, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_warwick_h3', 'warwick-h3', 'Warwick H3', 'warwick-h3', 'Warwick Hash House Harriers',
  'Warwick', r.id, 'UK',
  'https://www.warwickhash.org.uk/', 'https://www.facebook.com/WarwickHHH',
  'Monday', 'Weekly', '7:00 PM',
  'Monday evenings at 7:00 PM (very occasionally Tuesday when Monday is a public holiday).',
  true, '/kennel-logos/warwick-h3.png',
  'Warwick Hash House Harriers — a ''drinking club with a running problem'' — meet on Monday evenings for 3–4 mile flour-laid trails starting and finishing at a pub within about 10 miles of Warwick (Warwick, Leamington Spa, Kenilworth, Wellesbourne, Rugby). Runs are social, not races; walkers welcome.',
  52.2823, -1.5849,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Warwick'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "WH3" omitted — taken elsewhere).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_warwickh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Warwick Hash House Harriers'), (2, 'Warwick HHH'), (3, 'WHHH'), (4, 'Warwick Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'warwick-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Single "Next Run" block that lingers after the run →
--    upcomingOnly so reconcile never cancels it.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_warwick_h3_website', 'Warwick H3 Website', 'https://www.warwickhash.org.uk/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_warwick_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Warwick H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'warwick-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
