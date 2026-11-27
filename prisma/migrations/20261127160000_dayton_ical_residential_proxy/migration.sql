-- Dayton H3 HashStats iCal (added in 20261125200000_ws4_source_health_week1) failed its
-- first prod scrape: hashstats.org serves Cloudflare's "Just a moment…" challenge
-- (HTTP 403) to Vercel's datacenter IPs. The same feed comes back whole through the
-- NAS residential proxy, so the source opts into it (ICalSourceConfig.useResidentialProxy).
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || '{"useResidentialProxy": true}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'src_dayton_h3_hashstats_ical'
  AND type = 'ICAL_FEED'::"SourceType";

COMMIT;
