-- Alert fixes (2026-11-10): move Berlin H3 + Berlin Full Moon H3 off the iCal feed and
-- onto the same plugin's JSON API.
--
-- berlin-h3.eu serves runs through bb-Ricardo/wordpress-hash-event-api. Its calendar route
-- (/events.ics) always filters on `last_update > now - N weeks`, so a run leaves the feed
-- once its post goes unedited for a few weeks, however far ahead it is. The kennel
-- bulk-created runs #2362-#2370 and Full Moons #156-#157 on 2026-10-26; all 11 aged out
-- together on ~11-09, and the mass-cancel breaker refused the 11 cancellations
-- (EXCESSIVE_CANCELLATIONS). The runs are still published on /hareline/ and in
-- /api/v1/runs/all, which has no edit-date filter (BerlinH3ApiAdapter).
--
-- 1. Create "Berlin H3 Run API" and link it to berlinh3 + bh3fm.
-- 2. Disable "Berlin H3 iCal Feed" (seed carries enabled: false). Its RawEvents stay.
-- 3. Resolve the iCal feed's open alerts; they can't auto-resolve once it stops scraping.
--
-- DATA-ONLY, idempotent. Mirrors prisma/seed-data/sources.ts.

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_berlin_h3_run_api', 'Berlin H3 Run API',
  'https://www.berlin-h3.eu/api/v1/runs/all',
  'HTML_SCRAPER'::"SourceType", '{}'::jsonb,
  7, 'daily', 365, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_berlin_run_api_' || k."kennelCode", s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Berlin H3 Run API' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" IN ('berlinh3', 'bh3fm')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

UPDATE "Source"
SET enabled = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Berlin H3 iCal Feed' AND type = 'ICAL_FEED'::"SourceType" AND enabled;

UPDATE "Alert" a
SET status = 'RESOLVED', "resolvedAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC',
    details = COALESCE(a.details, '') || ' [Resolved: source retired for "Berlin H3 Run API" (alert fixes, 2026-11-10)]'
FROM "Source" s
WHERE a."sourceId" = s.id
  AND s.name = 'Berlin H3 iCal Feed' AND s.type = 'ICAL_FEED'::"SourceType"
  AND a.status IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED');
