-- Onboard Essex H3 (essex-h3, essexhhh.co.uk) — weekly Essex kennel founded
-- 1984; mix of Sunday 11:00 and weekday 19:00 runs.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the new
-- Essex region, the kennel, its aliases, the hareline source and the
-- SourceKennel link are applied here. src/lib/region.ts and
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Region: Essex METRO under United Kingdom.
INSERT INTO "Region" (
  id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor",
  "centroidLat", "centroidLng", "parentId", "createdAt", "updatedAt"
)
SELECT
  'rgn_essex_uk', 'Essex', 'essex', 'UK', 'METRO'::"RegionLevel",
  'Europe/London', 'ESX', 'bg-violet-100 text-violet-700', '#8b5cf6',
  51.74, 0.47, p.id, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" p
WHERE p.name = 'United Kingdom'
ON CONFLICT (name) DO NOTHING;

-- 2. Kennel.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "foundedYear", "dogFriendly", "walkersWelcome", "logoUrl", description,
  "createdAt", "updatedAt"
)
SELECT
  'knl_essex_h3', 'essex-h3', 'Essex H3', 'essex-h3', 'Essex Hash House Harriers',
  'Essex', r.id, 'UK',
  'https://essexhhh.co.uk', 'https://www.facebook.com/groups/255786294522554/',
  'Sunday', 'Weekly', '11:00 AM',
  'Weekly — a mix of Sunday 11:00 AM runs and weekday (usually Monday) 7:00 PM evening runs.',
  1984, true, true, '/kennel-logos/essex-h3.jpg',
  'Essex Hash House Harriers meet at a different pub in Essex each week for a run following a trail of flour, then a few drinks back at the pub. New faces always welcome — run, walk or crawl!',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Essex'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 3. Aliases (bare "EH3" omitted — Enfield/Edinburgh/Eugene/Edmonton collide).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_essexh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Essex Hash House Harriers'), (2, 'Essex HHH'), (3, 'Essex Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'essex-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 4. Source. Rolling forward hareline → upcomingOnly so reconcile never
--    cancels runs as they age off the page.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_essex_h3_hareline', 'Essex H3 Website Hareline', 'https://essexhhh.co.uk/hareline',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 5. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_essex_h3_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Essex H3 Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'essex-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
