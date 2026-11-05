-- Nov 2026 health sweep — source config convergence (data-only).
--
-- 1. Atlanta Hash Board: egress "vpn" → "residential" + fallbackEgress "vpn".
--    OVH's anti-DDoS in front of board.atlantahash.com now drops the rotated
--    VPN exit (185.198.240.147, every forum feed timed out at 30s on
--    2026-11-05) while accepting the home residential range it blocked in
--    mid-2026 (#2054). AtlantaHashBoardAdapter retries each feed through
--    fallbackEgress when the primary fails, so either side being blocked no
--    longer takes the source down. Live-verified: 37 events / 7 kennels / 0
--    errors via residential.
-- 2. LVH3 Hareline Calendar: disable. The Google Calendar ID returns 404 and
--    the source has never succeeded (28/28 FAILED this week). It was already
--    dropped from prisma/seed-data/sources.ts ("REMOVED: calendar ID returns
--    404"), but the seeder never disables rows it no longer lists, so the
--    prod row kept failing and alerting.
--
-- Idempotent: each UPDATE is a no-op once converged.

BEGIN;

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb)
      || jsonb_build_object('egress', 'residential', 'fallbackEgress', 'vpn'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Atlanta Hash Board'
  AND type::text = 'HTML_SCRAPER'
  AND (config->>'egress' IS DISTINCT FROM 'residential'
       OR config->>'fallbackEgress' IS DISTINCT FROM 'vpn');

UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'LVH3 Hareline Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND enabled = true;

COMMIT;
