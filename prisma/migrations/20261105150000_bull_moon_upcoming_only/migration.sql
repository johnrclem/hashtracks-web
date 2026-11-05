-- Bull Moon Upcoming Runs: set config.upcomingOnly = true.
--
-- BullMoonAdapter (src/adapters/html-scraper/bull-moon.ts) browser-renders the
-- Wix receding hareline, and the render is non-deterministic: two back-to-back
-- live runs on 2026-11-05 returned 567 vs 569 events, the first missing
-- T3 #106/#110/#111. With scrapeDays 3650 and no upcomingOnly, reconcile
-- treated every past run the render happened to miss as "removed from the
-- source" and cancelled it (3–21 per day since at least 2026-10-07); merge
-- auto-restored them on the next complete render, so they churned daily.
-- A past run missing from an archive page is never a cancellation signal;
-- upcomingOnly clamps reconcile to future dates (reconcile.ts), which still
-- catches genuine forward reschedules (T3 #232 moved 11-19 → 11-26).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- row is converged here; prisma/seed-data/sources.ts carries the same flag.
-- Idempotent: only touches the exact name+type row, only when not already true.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Bull Moon Upcoming Runs'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

COMMIT;
