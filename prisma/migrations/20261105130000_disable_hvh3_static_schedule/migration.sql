-- Happy Valley H3 (hvh3): disable the unverified "biweekly Thursday" static
-- schedule and clear the matching kennel schedule fields.
--
-- The STATIC_SCHEDULE rule (FREQ=WEEKLY;INTERVAL=2;BYDAY=TH, 18:30) was seeded
-- at onboarding with no recorded provenance. The kennel's own site
-- (happyvalleyh3.org/upcumming-runs, last modified 2023-05-02) listed roughly
-- monthly weekend-afternoon trails (#401 Sat 2023-05-06 2PM), and its only live
-- channel is a private Facebook group. With no anchorDate the rule also flipped
-- its biweekly parity every scrape, so reconcile cancelled and regenerated the
-- alternate Thursdays each week (29 cancellations in one scrape, 2026-11-05).
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- rows are converged here; prisma/seed-data carries the same values so a later
-- seed is a no-op. The already-generated FUTURE placeholder events are removed
-- by the dry-run-first one-shot scripts/cleanup-hvh3-static-placeholders.ts,
-- not here (provenance-scoped deletes stay out of migrations — see the VTH3
-- precedent in 20260603075924_triage_hkfh3_rename_elah3_hide).
--
-- Idempotent: every UPDATE is guarded on the audited stale value, so re-runs
-- and later admin edits are no-ops.

BEGIN;

-- 1. Stop generating events.
UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Happy Valley H3 Static Schedule'
  AND type::text = 'STATIC_SCHEDULE'
  AND enabled = true;

-- 2. Kennel profile: drop the unverified cadence, explain where trails live.
UPDATE "Kennel"
SET "scheduleDayOfWeek" = NULL,
    "scheduleFrequency" = NULL,
    "scheduleTime" = NULL,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hvh3'
  AND "scheduleDayOfWeek" = 'Thursday'
  AND "scheduleFrequency" = 'Biweekly';

UPDATE "Kennel"
SET "scheduleNotes" = 'No fixed schedule published — trails are announced in the Happy Valley H3 Facebook group.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hvh3'
  AND "scheduleNotes" IS NULL;

UPDATE "Kennel"
SET description = 'Hash House Harriers in Western Massachusetts since 1999.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hvh3'
  AND description = 'Biweekly Thursday hashes in Western Massachusetts.';

-- 3. Travel Mode / hareline projections: retire the derived schedule rule(s)
--    so nothing keeps predicting biweekly Thursdays.
UPDATE "ScheduleRule" sr
SET "isActive" = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id
  AND k."kennelCode" = 'hvh3'
  AND sr."isActive" = true;

COMMIT;
