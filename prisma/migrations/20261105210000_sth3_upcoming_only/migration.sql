-- Sydney Thirsty H3 Upcoming Runs: set config.upcomingOnly = true.
--
-- sth3.org/upcoming-runs lists only this week's and upcoming runs; each run
-- drops off once it has happened. With scrapeDays 180 and no upcomingOnly,
-- reconcile (reconcile.ts) treated every rolled-off past run as "removed from
-- the source" and cancelled it — 27 past runs by 2026-11-05. upcomingOnly
-- clamps reconcile to future dates. Restoring the already-cancelled runs is a
-- separate dry-run-first one-shot (scripts/uncancel-stale-by-source.ts).
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same flag.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Sydney Thirsty H3 Upcoming Runs'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

COMMIT;
