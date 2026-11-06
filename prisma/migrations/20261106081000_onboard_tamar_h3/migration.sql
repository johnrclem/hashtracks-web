-- Onboard Tamar Valley H3 (tamar-h3, tvh3.co.uk) — weekly Monday 19:00 hash
-- across western Dartmoor / the Tamar Valley, filed under the existing
-- Plymouth METRO.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the
-- kennel, aliases, source and SourceKennel link are applied here.
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "hashCash", "foundedYear", "dogFriendly", "walkersWelcome",
  description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_tamar_valley_h3', 'tamar-h3', 'Tamar Valley H3', 'tamar-valley-h3',
  'Tamar Valley Hash House Harriers', 'Plymouth', r.id, 'UK',
  'https://www.tvh3.co.uk/', 'https://www.facebook.com/profile.php?id=100051557537843',
  'Monday', 'Weekly', '7:00 PM',
  'Weekly Monday 7pm trail across western Dartmoor and the Devon/Cornwall Tamar Valley.',
  '£2', 1981, true, true,
  'Tamar Valley Hash House Harriers (est. 1981) — a weekly Monday-evening (7pm) hash running across western Dartmoor and the Devon/Cornwall Tamar Valley. £2 hash cash; walkers and dogs on leads welcome. Annual Red Dress Run and Brown Gin Run.',
  50.5486, -4.1425,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Plymouth'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Aliases (bare "TVH3" omitted — it belongs to Teign Valley H3).
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_tamarh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Tamar Valley H3'), (2, 'Tamar Valley Hash House Harriers'), (3, 'Tamar Valley HHH'))
       AS t(n, alias)
WHERE k."kennelCode" = 'tamar-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Homepage source. Forward-only page (next run + ~5 rows), so upcomingOnly
--    keeps reconcile from cancelling runs once they drop off.
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_tamar_h3_website', 'Tamar Valley H3 Website', 'https://www.tvh3.co.uk/',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 4. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_tamar_h3_website', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Tamar Valley H3 Website' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'tamar-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
