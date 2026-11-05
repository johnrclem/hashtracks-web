-- bangkokhash.com sources: set config.upcomingOnly = true.
--
-- BangkokHashAdapter now fetches the HashWebApp pages through the NAS browser
-- render (the site hangs up on both NAS relays since its Nov 2026 rebuild). The
-- rendered hareline view lists only future runs, so without upcomingOnly
-- reconcile would cancel every run once it had passed. Bangkok Thursday already
-- had 53 past runs cancelled that way. DATA-ONLY, idempotent; the seed matches.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name IN ('Bangkok Thursday Hash', 'Bangkok Full Moon Hash', 'Siam Sunday Hash')
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

COMMIT;
