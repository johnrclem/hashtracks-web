-- Silent-zero triage (2026-11-05): two sources that returned eventsFound = 0 on
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

COMMIT;
