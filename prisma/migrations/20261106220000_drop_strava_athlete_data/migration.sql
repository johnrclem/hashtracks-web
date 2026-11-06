-- Drop StravaConnection.athleteData (the cached Strava athlete name and avatar).
--
-- Strava API Policy §6.2 (effective 2026-06-01) caps Strava Data at a 7-day
-- cache.
--   * PR #2776 (migration 20261106190000_strava_transient_cache) stopped writing
--     and reading this column and nulled every row.
--   * PR #2783 then unmapped it from the Prisma model, so deployed code no longer
--     selects it.
-- Merge this only after #2783 is live in production. `migrate deploy` runs
-- before the new build serves, so dropping the column while a deployment
-- still maps it would break every StravaConnection query.
--
-- Destructive DDL, but the column holds no data: all 3 prod rows were NULL in
-- the 2026-11-06 dry-run. IF EXISTS keeps re-runs harmless.

ALTER TABLE "StravaConnection" DROP COLUMN IF EXISTS "athleteData";
