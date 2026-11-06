-- Onboard Dhekelia H3 (dh3-cy) — Cyprus, founded 30 Jan 1967. Region "Larnaca"
-- comes from 20261106100100_onboard_lh3_cy.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.

BEGIN;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes",
  "hashCash", "foundedYear", "walkersWelcome", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_dh3_cy', 'dh3-cy', 'Dhekelia H3', 'dhekelia-h3', 'Dhekelia Hash House Harriers',
  'Larnaca', r.id, 'Cyprus', 'https://dhekelia-h3.com/',
  'Wednesday', 'Weekly', 'Every Wednesday regardless of the weather; 4 PM in winter, 6 PM in summer.',
  '€3', 1967, true, '/kennel-logos/dh3-cy.png',
  'Dhekelia Hash House Harriers, founded 30 January 1967 at Dhekelia Garrison — the first hash in Cyprus and self-styled ''Europe''s oldest hash''. Meets every Wednesday around the Larnaca district for about an hour (~4K walkers / 8K runners), followed by a beer and nibbles.',
  34.982, 33.758,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Larnaca'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_dh3cy_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Dhekelia H3'), (2, 'Dhekelia HHH'), (3, 'Dhekelia Hash House Harriers'),
             (4, 'Dhekelia Hash'), (5, 'DH3-CY'))
       AS t(n, alias)
WHERE k."kennelCode" = 'dh3-cy'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_dh3_cy_nextrun', 'Dhekelia H3 Website Next Run',
  'https://dhekelia-h3.com/wp-json/wp/v2/pages?slug=info',
  'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb,
  6, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_dh3_cy_nextrun', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Dhekelia H3 Website Next Run' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'dh3-cy'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
