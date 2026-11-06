-- Onboard Surrey H3 (surrey-h3, surreyhashhouseharriers.com) — weekly Sunday
-- 11:00 county-wide Surrey kennel founded 1975. Distinct from Old Coulsdon
-- (och3), which shares the "Surrey" region.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the kennel,
-- its aliases, the hareline source and the SourceKennel link are applied here.
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "hashCash", "foundedYear", founder, "walkersWelcome", "logoUrl", description,
  "createdAt", "updatedAt"
)
SELECT
  'knl_surrey_h3', 'surrey-h3', 'Surrey H3', 'surrey-h3', 'Surrey Hash House Harriers',
  'Surrey', r.id, 'UK',
  'https://surreyhashhouseharriers.com', 'Sunday', 'Weekly', '11:00 AM',
  '£2 (visitors; first visit free)', 1975, 'Jim Raper', true, '/kennel-logos/surrey-h3.jpg',
  'Surrey Hash House Harriers — a non-competitive running and walking club founded in 1975. Every Sunday at 11:00 the pack follows a flour trail of 4–5 miles around the Surrey countryside, with shortcuts and loops so all abilities finish together, then heads ''On On'' to a local pub. Visitors welcome — £2, first visit free.',
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Surrey'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Aliases (bare "SH3" deliberately omitted — globally ambiguous).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_surreyh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Surrey Hash'), (2, 'Surrey Hash House Harriers'), (3, 'Surrey HHH'))
       AS t(n, alias)
WHERE k."kennelCode" = 'surrey-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Source. Rolling forward hareline → upcomingOnly so reconcile never cancels
--    runs that age off the page (or the frozen history backfill).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_surrey_h3_hareline', 'Surrey H3 Website Hareline',
  'https://surreyhashhouseharriers.com/receding-hareline/',
  'HTML_SCRAPER'::"SourceType",
  '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 120, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 4. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_surrey_h3_hareline', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Surrey H3 Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'surrey-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
