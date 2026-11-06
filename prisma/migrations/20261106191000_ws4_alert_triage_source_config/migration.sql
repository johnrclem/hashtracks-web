-- WS4 alert triage (Nov 2026): source-config fixes.
--
-- 1. Sacramento H3 Squarespace Events: upcomingOnly. Squarespace's events JSON
--    pages past events by `publishOn` (offset = last item's publishOn) but orders
--    them by `startDate`. Runs published later than older runs fall between pages:
--    on 2026-11-05 page 2 jumped from 2026-06-05 to 2026-03-14, so runs #1719–#1730
--    (2026-03-18 .. 2026-06-03) left the walk and reconcile cancelled 14 of them
--    (EXCESSIVE_CANCELLATIONS alert). The runs still exist on the site. Every run is
--    first captured from the complete upcoming list, so the past-page gap only
--    matters to reconcile. Restoring the 14 is a separate, dry-run-first one-shot.
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same values.

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Sacramento H3 Squarespace Events'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;
