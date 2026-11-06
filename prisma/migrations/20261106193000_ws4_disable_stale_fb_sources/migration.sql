-- WS4 E2 (Nov 2026 triage, owner-approved 2026-11-06): retire three Facebook Hosted
-- Events sources that FB has soft-blocked for months (HTTP 200 + empty SSR envelope;
-- they fail loud every scrape because they are useResidentialProxy Pages, #2589).
--   SOH4 FB       — failing since 2026-07-07; SOH4 Website still covers soh4.
--   Von Tramp FB  — failing since 2026-09-12; Von Tramp Squarespace still covers vth3.
--   Survivor H3 FB — failing since 2026-07-07, never produced an event, and it was the
--                   kennel's only source (survivorh3.com does not respond), so the
--                   survivor-h3 kennel is hidden.
-- Their open SCRAPE_FAILURE / CONSECUTIVE_FAILURES alerts can't auto-resolve once the
-- sources stop scraping, so they are resolved here.
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries enabled: false; the seed
-- never writes Kennel.isHidden.

UPDATE "Source"
SET enabled = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE type::text = 'FACEBOOK_HOSTED_EVENTS'
  AND name IN ('SOH4 Facebook Hosted Events', 'Von Tramp H3 Facebook Hosted Events',
               'Survivor H3 Facebook Hosted Events')
  AND enabled;

UPDATE "Kennel"
SET "isHidden" = true, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'survivor-h3' AND NOT "isHidden";

UPDATE "Alert" a
SET status = 'RESOLVED', "resolvedAt" = NOW() AT TIME ZONE 'UTC',
    details = COALESCE(a.details, '') || ' [Resolved: source disabled — WS4 E2, 2026-11-06]'
FROM "Source" s
WHERE a."sourceId" = s.id
  AND s.type::text = 'FACEBOOK_HOSTED_EVENTS'
  AND s.name IN ('SOH4 Facebook Hosted Events', 'Von Tramp H3 Facebook Hosted Events',
                 'Survivor H3 Facebook Hosted Events')
  AND a.status IN ('OPEN', 'ACKNOWLEDGED');
