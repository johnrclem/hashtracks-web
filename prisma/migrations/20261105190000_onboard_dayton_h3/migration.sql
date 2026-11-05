-- Onboard Dayton H3 (dh3-oh, daytonhhh.org) — the parent Dayton kennel (est.
-- 1987), distinct from DH4 (dh4, daytonhash.com) which split off ~2021.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the kennel,
-- its aliases, the Tribe source and the SourceKennel link are applied here.
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- Idempotent (ON CONFLICT on natural keys); safe to re-apply.

BEGIN;

-- 1. Kennel (region resolved by name, no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "facebookUrl", "scheduleDayOfWeek", "scheduleFrequency", "scheduleTime",
  "scheduleNotes", "hashCash", "foundedYear", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_dayton_h3_oh', 'dh3-oh', 'Dayton H3', 'dayton-h3', 'Dayton Hash House Harriers',
  'Dayton, OH', r.id, 'USA',
  'https://daytonhhh.org/', 'https://www.facebook.com/daytonhhh',
  'Saturday', 'Biweekly', '4:00 PM',
  'Every other Saturday (4 PM during Daylight Saving Time, 3 PM in winter) plus full moon evenings at 7 PM.',
  '$8 ($4 non-drinkers)', 1987,
  'Ohio''s oldest hash kennel — first run June 28, 1987. Hashes every other Saturday plus full moon evenings, with annual specials like the New Year''s Day Hangover Hash, Spring Formal, World Peace Through Beer and a Red Dress run joint with sister kennel Sin City H4. Parent of SWOT, Miami Valley, UnMASKED, ON-IN and DH4.',
  39.76, -84.19,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Dayton, OH'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Move the "Dayton H3" / "Dayton HHH" aliases off dh4 (they named the parent
--    kennel, which HashTracks didn't have yet), then add dh3-oh's aliases.
DELETE FROM "KennelAlias" a
USING "Kennel" k
WHERE a."kennelId" = k.id AND k."kennelCode" = 'dh4'
  AND a.alias IN ('Dayton H3', 'Dayton HHH');

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_dh3oh_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Dayton H3'), (2, 'Dayton HHH'), (3, 'Dayton Hash House Harriers'), (4, 'DH3 Dayton'))
       AS t(n, alias)
WHERE k."kennelCode" = 'dh3-oh'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Tribe source (config-routed to the shared TribeEventsAdapter). Forward-only
--    feed, so upcomingOnly is REQUIRED (the adapter fails closed without it).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_dayton_h3_tribe', 'Dayton H3 Events Calendar', 'https://daytonhhh.org',
  'HTML_SCRAPER'::"SourceType",
  '{"tribeEvents": true, "kennelTag": "dh3-oh", "upcomingOnly": true, "haresFromOrganizers": true, "runNumberFromTitle": true}'::jsonb,
  8, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 4. SourceKennel link (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_dayton_h3_tribe', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Dayton H3 Events Calendar' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" = 'dh3-oh'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
