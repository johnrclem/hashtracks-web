-- Disable the Top End Hash Hareline (Darwin, top-end-h3) ICAL_FEED source (#2662).
--
-- topendhash.com's WordPress + Events Manager site is gone. Every URL under the
-- domain — the homepage AND the iCal export path
-- (/?post_type=event&ical=1&limit=50) — now resolves to a GoDaddy "Great things
-- are coming soon" domain-parking page (verified live 2026-08-12), not a 404 or a
-- plugin-removed error page. The whole site was torn down, not just the calendar
-- plugin, so no parser fix is possible.
--
-- The club (Topend HHH, Thursdays 1800) is still listed as active on the
-- official HHH directory (hhh.asn.au) but its only other online presence is a
-- private Facebook GROUP (facebook.com/groups/TopEndHash) — Groups require
-- login and are not reachable by the FACEBOOK_HOSTED_EVENTS adapter, which only
-- scrapes public Pages' /upcoming_hosted_events tab. No replacement source
-- exists to cut over to (unlike hashnyc's HTML->iCal cutover), so this is a
-- straight disable rather than a swap.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so this
-- migration disables the source directly. A later `db seed` converges the same
-- row as a no-op (prisma/seed-data/sources.ts carries `enabled: false`).
--
-- Idempotent: only touches an *enabled* row of this exact name+type. Safe to
-- re-apply. Re-enable (here and in seed) if the club relaunches a public feed.

BEGIN;

UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Top End Hash Hareline'
  AND type::text = 'ICAL_FEED'
  AND enabled = true;

COMMIT;
