-- STL H3 Substack: set upcomingOnly (Nov 2026 triage, WS4 / G1).
--
-- The Substack archive is a newest-first post feed. Before this fix the adapter
-- read only the first page, so each run aged out of the fetch a few months after
-- it happened, and reconcile cancelled it: 21 past runs (2026-01-04 .. 2026-05-24)
-- plus the 2026-09-27 run were CANCELLED in prod at authoring. The adapter now
-- follows Substack's cursor pagination, and upcomingOnly keeps reconcile off past
-- runs. The cancelled rows are not admin-locked, so the first scrape after deploy
-- re-emits them and merge auto-restores them.
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same value.

UPDATE "Source"
-- Non-object configs (SQL NULL or a JSON scalar such as 'null') start from {} so
-- jsonb_set can't fail with "cannot set path in scalar".
SET config = jsonb_set(
      CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END,
      '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'STL H3 Substack'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;
