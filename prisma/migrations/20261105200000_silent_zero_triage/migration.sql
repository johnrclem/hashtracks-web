-- Silent-zero triage (2026-11-05): sources that returned eventsFound = 0 on
-- every scrape for the whole 30-day ScrapeLog retention.
--
-- 1. West Central FL Hash Calendar (11 Tampa Bay kennels) — DEAD.
--    jollyrogerh3.com/WCFH_Calendar.htm now reads "The below calendar
--    information been discontinued until further notice." (Last-Modified
--    2026-05-15); every month grid cell is empty. Nothing to parse. Disable it.
--    The 11 kennels keep their SourceKennel links; replacement per-kennel
--    sources are a follow-up (the page points visitors to each kennel's site).
--
-- 2. Cherry City H3 Calendar (cch3-or) — DRIFT.
--    Every entry on the C2H3 Google Calendar is an all-day event, which the
--    GOOGLE_CALENDAR adapter drops unless config.includeAllDayEvents is true.
--    Live-verified with the flag: 11 events 2026-01-25 → 2026-11-07.
--
-- 3. Mr. Happy's H3 Google Calendar (mrhappy) — DRIFT (stale suppression).
--    #1708 put the 2021 weekly RRULE's iCalUID in suppressICalUids as a dormant
--    series. The kennel revived it and edits each Wednesday occurrence in place
--    (same iCalUID), so the suppression silently dropped every real run.
--    Remove the key. Live-verified: 25 events 2026-08-12 → 2027-01-27.
--
-- 4. True Trail H3 Hareline (tth3-ab) — DRIFT. The Astro rebuild renders the
--    hareline from a published Google Sheet; the adapter now reads that CSV
--    (14 runs #177–#190). The sheet starts at #177, so upcomingOnly keeps
--    reconcile from cancelling the older in-window runs already in the DB.
--
-- 5. Burlington H3 (burlyh3) — DRIFT. The hareline dropped its per-event
--    "Add to Google Calendar" links; it now links one public Google Calendar
--    (also carrying other VT kennels). Insert a GOOGLE_CALENDAR source with
--    strict BTVH3 routing and disable the HTML source. Live-verified: 32 BTVH3
--    events 2026-04-01 → 2026-11-28. The disabled source's RawEvents remain,
--    so reconcile's other-source guard protects their canonical events.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- rows are converged here; prisma/seed-data/sources.ts carries the same values
-- so a later seed is a no-op. Idempotent: each UPDATE is guarded on the audited
-- current value.

BEGIN;

UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'West Central FL Hash Calendar'
  AND type::text = 'HTML_SCRAPER'
  AND enabled = true;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{includeAllDayEvents}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Cherry City H3 Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (config->'includeAllDayEvents') IS DISTINCT FROM 'true'::jsonb;

UPDATE "Source"
SET config = config - 'suppressICalUids',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Mr. Happy''s H3 Google Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND config ? 'suppressICalUids';

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'True Trail H3 Hareline'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Burlington H3 Website Hareline'
  AND type::text = 'HTML_SCRAPER'
  AND enabled = true;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'burlyh3') THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "burlyh3" not found — Burlington GCal link will no-op (run prisma db seed)';
  END IF;
END $$;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'mig_20261105_burlyh3_gcal',
  'Burlington H3 Google Calendar',
  '87d11c51005016fd7372d0fe76609bd0c3367183c3d7d944e5ca4b55bc5af87c@group.calendar.google.com',
  'GOOGLE_CALENDAR'::"SourceType",
  jsonb_build_object(
    'calendarId', '87d11c51005016fd7372d0fe76609bd0c3367183c3d7d944e5ca4b55bc5af87c@group.calendar.google.com',
    'kennelPatterns', jsonb_build_array(jsonb_build_array('\bBTVH3\b|\bBurlington H3\b', 'burlyh3')),
    'defaultKennelTag', 'burlyh3',
    'strictKennelRouting', true
  ),
  8, 'every_6h', 365,
  true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'mig_20261105_burlyh3_gcal_sk', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Burlington H3 Google Calendar'
  AND s.type = 'GOOGLE_CALENDAR'::"SourceType"
  AND k."kennelCode" = 'burlyh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
