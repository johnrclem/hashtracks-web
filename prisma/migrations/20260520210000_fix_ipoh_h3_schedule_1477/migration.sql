-- Fix Ipoh H3 STATIC_SCHEDULE: Saturday@17:00 → Monday@18:00 (#1477)
--
-- malaysiahash.com directory entry for Ipoh Hash House Harriers (Men) reads
-- "Runs every Men: Mondays @6:00pm". The Source.config was wrong from launch
-- (BYDAY=SA, startTime=17:00 — placeholder cut-and-paste from JB / Penang), so
-- every event the adapter ever emitted fell on the wrong day AND wrong time.
-- A user trusting HashTracks would show up Saturday at 5pm to an empty trail.
--
-- The seed file (prisma/seed-data/sources.ts) has been corrected in this PR;
-- this migration applies the same correction to the live `Source` row and
-- cleans up the orphan Saturday events. Without it, the only way for the fix
-- to reach prod is a manual `npx prisma db seed` — Vercel's deploy step only
-- runs `prisma migrate deploy`. Codex adversarial review on PR #1519 flagged
-- this rollout gap; the migration closes it.
--
-- Idempotency:
--   * UPDATE matches only the OLD wrong shape (rrule=BYDAY=SA). Once applied,
--     re-runs no-op.
--   * DELETE matches Ipoh events whose (day-of-week, startTime) fingerprint
--     identifies them as ghosts from the wrong config. After the source is
--     corrected, no future Ipoh event will fall on Saturday@17:00, so
--     re-runs stay safe even if a fresh DB is seeded straight to MO/18:00.

BEGIN;

-- Sanity: refuse the migration if the Ipoh source or kennel is missing,
-- so an unexpected schema mismatch fails loud rather than silently no-op'ing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Source"
    WHERE name = 'Ipoh H3 Static Schedule' AND type = 'STATIC_SCHEDULE'
  ) THEN
    RAISE EXCEPTION 'Source "Ipoh H3 Static Schedule" not found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'ipoh-h3') THEN
    RAISE EXCEPTION 'Kennel "ipoh-h3" not found';
  END IF;
END $$;

-- Part 1: correct the Source.config. Field-level merge via `||` preserves any
-- other keys an admin may have set; the WHERE on the OLD rrule means we only
-- touch the row when it still carries the wrong shape.
UPDATE "Source"
SET config = config || jsonb_build_object(
      'rrule', 'FREQ=WEEKLY;BYDAY=MO',
      'startTime', '18:00',
      'defaultDescription',
        'Weekly Monday evening trail (men''s chapter). Founded 31 Jan 1965, one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.'
    ),
    "updatedAt" = NOW()
WHERE name = 'Ipoh H3 Static Schedule'
  AND type = 'STATIC_SCHEDULE'
  AND config->>'rrule' = 'FREQ=WEEKLY;BYDAY=SA';

-- Part 2: cascade-delete ghost Saturday@17:00 Ipoh events. All Ipoh canonical
-- Events come from this one STATIC_SCHEDULE source, so the (kennelCode +
-- day-of-week + startTime) fingerprint unambiguously identifies them as
-- ghosts. Past + upcoming both removed — the past Saturdays are fictional
-- and would poison the kennel heatmap and lifetime-event count.
--
-- FK-safe ordering mirrors scripts/lib/cascade-delete.ts (and the admin
-- bulkDeleteEvents() flow):
--   1. Unlink RawEvent (preserve immutable audit trail; processed=false so a
--      future scrape can re-emit if a real Saturday event somehow exists)
--   2. Null out parentEventId back-refs (prevent FK violation on delete)
--   3. Delete EventHare, Attendance, KennelAttendance child rows
--   4. Delete the Event rows (EventLink cascades via onDelete: Cascade)

CREATE TEMPORARY TABLE ipoh_ghost_events ON COMMIT DROP AS
SELECT e.id
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
WHERE k."kennelCode" = 'ipoh-h3'
  AND e."startTime" = '17:00'
  AND EXTRACT(DOW FROM e.date) = 6;  -- Saturday (Postgres DOW: Sun=0..Sat=6)

UPDATE "RawEvent"
SET "eventId" = NULL, processed = false
WHERE "eventId" IN (SELECT id FROM ipoh_ghost_events);

UPDATE "Event"
SET "parentEventId" = NULL
WHERE "parentEventId" IN (SELECT id FROM ipoh_ghost_events);

DELETE FROM "EventHare"        WHERE "eventId" IN (SELECT id FROM ipoh_ghost_events);
DELETE FROM "Attendance"       WHERE "eventId" IN (SELECT id FROM ipoh_ghost_events);
DELETE FROM "KennelAttendance" WHERE "eventId" IN (SELECT id FROM ipoh_ghost_events);
DELETE FROM "Event"            WHERE id        IN (SELECT id FROM ipoh_ghost_events);

-- Part 3: recompute Kennel.lastEventDate. The cache field only goes UP via
-- merge.ts (#1287); deletions leave it stale otherwise. Self-heals on next
-- scrape but explicit reset is cleaner and matches the cleanup-after-parser-
-- fix pattern documented in the auto-memory note.
UPDATE "Kennel"
SET "lastEventDate" = (
  SELECT MAX(date) FROM "Event" WHERE "kennelId" = "Kennel".id
)
WHERE "kennelCode" = 'ipoh-h3';

COMMIT;
