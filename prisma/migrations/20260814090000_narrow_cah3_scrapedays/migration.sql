-- Narrow the Cha-Am H3 Website (HTML_SCRAPER) source's scrapeDays from 365
-- to 150 to close a false-cancellation risk found in #2668 PR review.
--
-- The adapter always fetches a FIXED 20 most-recent WordPress posts
-- (fetchWordPressPosts(baseUrl, 20)) and ignores `options.days` entirely, so
-- its true ground-truth horizon is however far back those 20 posts reach —
-- NOT the configured scrapeDays. reconcile.ts uses the SAME scrapeDays value
-- as its own cancellation window (there is no adapter->reconcile channel for
-- "I only actually covered N days"), so scrapeDays=365 against a ~150-200
-- day real fetch horizon risked reconcile marking a genuinely still-live
-- event CANCELLED just because it fell outside the last-20-posts batch.
--
-- Live evidence 2026-08-14: only 2 of the 20 most-recently-fetched posts had
-- a parseable date at all (the site redesigned its post template with no
-- date field — see #2668), and the older of the two was already dated
-- 2026-01-19, ~207 days back. 150 stays safely under that observed floor.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so this
-- migration updates the existing prod row directly. A later `db seed`
-- converges the same value as a no-op (prisma/seed-data/sources.ts already
-- carries scrapeDays: 150). Idempotent: only touches a row that still has
-- the old 365 value. Safe to re-apply. Does NOT touch the "Cha-Am H3 Static
-- Schedule" sibling source — that source generates synthetic events
-- algorithmically, not via a bounded fetch, so its 365-day window is safe.

BEGIN;

UPDATE "Source"
SET "scrapeDays" = 150,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Cha-Am H3 Website'
  AND type::text = 'HTML_SCRAPER'
  AND "scrapeDays" = 365;

COMMIT;
