-- Add FACEBOOK_HOSTED_EVENTS to the SourceType enum.
--
-- Backs the new adapter at `src/adapters/facebook-hosted-events/` which
-- scrapes `https://www.facebook.com/{page}/upcoming_hosted_events` for
-- public Facebook Pages. Pure additive — no existing rows touched.
--
-- `IF NOT EXISTS` matches the convention in prior enum-add migrations
-- (e.g. 20260420083800_travel_multi_destination,
-- 20260422140239_add_reconcile_suppressed_alert_type). Postgres permits
-- this form inside Prisma's wrapping transaction since Postgres 12.

ALTER TYPE "SourceType" ADD VALUE IF NOT EXISTS 'FACEBOOK_HOSTED_EVENTS';
