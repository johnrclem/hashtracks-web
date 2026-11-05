-- upcomingOnly sweep: 43 sources whose fetch drops past runs.
--
-- reconcile.ts cancels CONFIRMED sole-source events in now−scrapeDays…now+scrapeDays
-- that are missing from a scrape, unless config.upcomingOnly clamps it to future
-- dates. A 2026-11-05 prod sweep found 65 sources with past runs cancelled AFTER
-- the run date. Each affected adapter was run live. For these 43, the fetch returns
-- no past events, or none earlier than a rolling cutoff inside the reconcile window,
-- and every one of their wrong cancellations falls in that uncovered gap:
-- Harrier Central getEvents (future-only), logged-out Meetup, "upcoming runs" HTML
-- pages, and rolling iCal windows. Full-history Google Calendars whose
-- cancellations fall inside the covered range are deliberately excluded.
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same flag.
-- Restoring the already-cancelled runs is a separate, dry-run-first one-shot.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb
  AND name IN (
    'Taiwan H3 Harrier Central',
    'Tokyo H3 Harrier Central',
    'Lisbon H3 Harrier Central',
    'Porto Invicta H3 Harrier Central',
    'Singapore Sunday H3 Harrier Central',
    'Hamburg H7 Harrier Central',
    'Manchester H3 Harrier Central',
    'LSW Hareline',
    'Samurai H3 Website',
    'Phuket HHH Hareline',
    'IndyScent H3 Upcumming Hashes',
    'Calgary H3 Upcoming Runs',
    'Brew City H3 Website',
    'Geriatrix H3 Receding Hareline',
    'Capital H3 Website',
    'OH3 Ottawa Receding Hare Line',
    'Garden City H3 Website',
    'F3H3 Website',
    'Sydney Larrikins Upcoming Runs',
    'Kampong H3 Website',
    'Chiang Mai CBH3 Hareline',
    'Miami H3 Meetup',
    'SFH3 MultiHash iCal Feed',
    'Richmond H3 Meetup',
    'Stockholm HHH iCal Feed',
    'Oslo H3 iCal Feed',
    'Hogtown H3 Meetup',
    'Berlin H3 iCal Feed',
    'KJ Harimau H3 Blog',
    'Zurich H3 Meetup',
    'Lion City H3 Website',
    'Auckland Hussies Run List',
    'Petaling H3 Hareline',
    'Bangkok Harriettes Blog',
    'Melbourne New Moon Meetup',
    'Chiang Mai CGH3 Hareline',
    'Montreal H3 Meetup',
    'Rubber City H3 Meetup',
    'N2TH3 WordPress Blog',
    'DCH4 WordPress Trail Posts',
    'Charlotte H3 Meetup',
    'Sumo H3 Website',
    'Reading H3 Localendar'
  );

COMMIT;
