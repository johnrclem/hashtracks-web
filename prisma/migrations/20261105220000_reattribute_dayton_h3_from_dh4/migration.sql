-- Re-home Dayton H3 history that sits on the DH4 kennel (follow-up to #2697).
--
-- Before #1018 the "DH4 Google Calendar" source read dh3calendar@gmail.com, the
-- Dayton H3 calendar, so DH3 runs were filed under `dh4`. When the source
-- switched to dh4calendar@gmail.com those RawEvents went away, leaving orphan
-- canonical Events (no RawEvent) on dh4. Dayton H3 now exists as `dh3-oh`
-- (#2697), so the orphans move back to it before the history backfill runs;
-- otherwise every DH3-era date would show under both kennels.
--
-- DH3 vs DH4 rule (verified read-only against prod + the daytonhhh.org archive,
-- 2026-11-05):
--   * DH4 forked off the shared run count in early 2022: DH3 #1500 was
--     2022-02-19, the first DH4-numbered trail was "DH4 #1499" on 2022-03-19.
--     Every orphan before 2022-03-19 is Dayton H3 (12/12 spot checks of the
--     untitled Sept 2021 – Feb 2022 rows matched DH3 runs on daytonhhh.org).
--   * On/after that date, only orphans whose title names DH3 / Dayton H3 and
--     NOT DH4 / Dayton H4 are Dayton H3. Generic titles ("Drinking Practice…",
--     "Dayton H4 Trail #1500") stay on dh4 — they fit DH4's own sequence.
--   * Rows backed by any RawEvent are never touched (all are real DH4 events
--     from the live DH4 sources).
-- None of this involves Dublin H3 (`dh3`): its 222 events all come from the
-- Dublin H3 Website Hareline and are Irish Monday runs.
--
-- Actions:
--   1. CONFIRMED DH3 orphans  → reassigned to dh3-oh (EventKennel + Event.kennelId).
--      Reassign rather than delete: ~30 of them (early-2021 runs, meetings)
--      exist nowhere in the daytonhhh.org archive.
--   2. CANCELLED DH3 orphans  → deleted. They are reconcile-cancelled copies and
--      renumbered calendar placeholders; the backfill recreates any real run as
--      CONFIRMED. Guarded in the DELETE itself: no EventHare, Attendance,
--      KennelAttendance, RawEvent or series parent/child links.
--   3. Recompute cached lastEventDate for both kennels.
-- Expected on prod at authoring time: 217 reassigned, 66 deleted.
-- Idempotent: a re-run finds no remaining matching orphans on dh4.

BEGIN;

CREATE TEMP TABLE dh3_orphans ON COMMIT DROP AS
SELECT e.id, e.status::text AS status
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
WHERE k."kennelCode" = 'dh4'
  AND NOT EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = e.id)
  AND (
    e.date < TIMESTAMP '2022-03-19'
    OR (
      e.title ~* '(^|[^a-z0-9])(DH3|Dayton H3)([^a-z0-9]|$)'
      AND e.title !~* '(DH4|Dayton H4)'
    )
  );

-- 1. Reassign CONFIRMED (and any other non-cancelled) orphans to dh3-oh.
UPDATE "EventKennel" ek
SET "kennelId" = oh.id
FROM dh3_orphans o, "Kennel" dh4, "Kennel" oh
WHERE ek."eventId" = o.id
  AND o.status <> 'CANCELLED'
  AND dh4."kennelCode" = 'dh4' AND oh."kennelCode" = 'dh3-oh'
  AND ek."kennelId" = dh4.id
  AND NOT EXISTS (
    SELECT 1 FROM "EventKennel" x WHERE x."eventId" = ek."eventId" AND x."kennelId" = oh.id
  );

UPDATE "Event" e
SET "kennelId" = oh.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM dh3_orphans o, "Kennel" dh4, "Kennel" oh
WHERE e.id = o.id
  AND o.status <> 'CANCELLED'
  AND dh4."kennelCode" = 'dh4' AND oh."kennelCode" = 'dh3-oh'
  AND e."kennelId" = dh4.id;

-- 2. Delete CANCELLED orphans (EventKennel / EventLink cascade). Dependents that
--    RESTRICT the delete are excluded up front so nothing user-facing is lost.
DELETE FROM "Event" e
USING dh3_orphans o
WHERE e.id = o.id
  AND o.status = 'CANCELLED'
  AND NOT EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "EventHare" h WHERE h."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "Event" c WHERE c."parentEventId" = e.id)
  AND e."parentEventId" IS NULL;

-- 3. Recompute cached lastEventDate for both kennels, mirroring the nightly
--    backfillLastEventDates() predicate (primary FK OR co-host EventKennel;
--    not CANCELLED, not manual entry, canonical) so the value doesn't flip-flop.
UPDATE "Kennel" k
SET "lastEventDate" = (
  SELECT MAX(e.date) FROM "Event" e
  WHERE (e."kennelId" = k.id
         OR EXISTS (SELECT 1 FROM "EventKennel" ek WHERE ek."eventId" = e.id AND ek."kennelId" = k.id))
    AND e.status::text <> 'CANCELLED'
    AND e."isManualEntry" IS NOT TRUE
    AND e."isCanonical" = true
)
WHERE k."kennelCode" IN ('dh4', 'dh3-oh');

COMMIT;
