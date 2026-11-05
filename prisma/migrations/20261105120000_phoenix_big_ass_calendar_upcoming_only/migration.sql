-- Phoenix H3 Big Ass Calendar: set config.upcomingOnly = true.
--
-- PhoenixHHHAdapter (src/adapters/html-scraper/phoenixhhh.ts) has fetched
-- forward-only since #2242 — it starts at the current calendar month and never
-- re-requests past months. The source config never got `upcomingOnly: true`,
-- so reconcileStaleEvents (src/pipeline/reconcile.ts) kept its default window
-- of now−scrapeDays … now+scrapeDays (±90d). Every already-run event in the
-- trailing 90 days was therefore "missing from the scrape" and got cancelled —
-- 89 events across all 4 Phoenix kennels in a single scrape on 2026-11-05.
-- upcomingOnly clamps the reconcile window to future dates, matching the
-- forward-only fetch (same pairing TribeEventsAdapter enforces in code).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- row is converged here; prisma/seed-data/sources.ts carries the same flag so a
-- later seed is a no-op. Restoring the already-cancelled past events is a
-- separate, dry-run-first one-shot (not done in a migration).
--
-- Idempotent: only touches the exact name+type row, and only when the flag is
-- not already true.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Phoenix H3 Big Ass Calendar'
  AND type::text = 'HTML_SCRAPER'
  AND (config->>'upcomingOnly') IS DISTINCT FROM 'true';

COMMIT;
