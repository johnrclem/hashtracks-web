-- Onboard Milton Keynes H3 (mkh3, mkh3.co.uk) — Monday-evening kennel founded
-- 1990, currently about fortnightly.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Milton Keynes region, the kennel, its aliases, the website source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Milton Keynes METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_milton_keynes_uk', 'Milton Keynes', 'milton-keynes', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'MKY', 'bg-violet-100 text-violet-700', '#8b5cf6',
  52.04, -0.76, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "foundedYear", "walkersWelcome", "logoUrl", description,
  "createdAt", "updatedAt"
)
SELECT
  'knl_mkh3', 'mkh3', 'MKH3', 'mkh3', 'Milton Keynes Hash House Harriers',
  'Milton Keynes', r.id, 'UK',
  'https://mkh3.co.uk', 'https://www.facebook.com/MiltonKeynesH3/',
  'Monday', 'Fortnightly', '7:00 PM',
  'Monday evenings, currently about fortnightly — meet in the pub from ~6:50pm, run ~7pm. Weekly from 1990; occasional daytime bank-holiday and special runs.',
  1990, true, '/kennel-logos/mkh3.gif',
  'A drinking club with a running problem — hashing in and around Milton Keynes since 1990. Monday-evening trails of 3–4 miles with checks, holds and fish hooks so walkers, joggers and runners of all abilities can join, then beer and the hash circle.',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Milton Keynes'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_mkh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Milton Keynes H3'), (2, 'MK Hash House Harriers'),
             (3, 'Milton Keynes Hash House Harriers'), (4, 'MKHHH'))
       AS t(n, alias)
WHERE k."kennelCode" = 'mkh3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Rolling near-term widgets → upcomingOnly so reconcile never
--    cancels runs that age off (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_mkh3_website', 'MKH3 Website', 'https://mkh3.co.uk/runs-events',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_mkh3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'MKH3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'mkh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
