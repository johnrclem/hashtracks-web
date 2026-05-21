-- Fix Ipoh H3 STATIC_SCHEDULE: Saturday@17:00 → Monday@18:00 (#1477)
--
-- malaysiahash.com directory entry for Ipoh Hash House Harriers (Men) reads
-- "Runs every Men: Mondays @6:00pm". The Source.config was wrong from launch
-- (BYDAY=SA, startTime=17:00 — placeholder cut-and-paste from JB / Penang),
-- so every event the adapter ever emitted fell on the wrong day AND wrong
-- time. The seed file (prisma/seed-data/sources.ts) has been corrected in
-- this PR; this migration applies the same correction to the live `Source`
-- row, repairs the derived ScheduleRule, and removes the orphan Saturday
-- events. Without it the only path to prod is a manual `npx prisma db
-- seed`, which Vercel does not run.
--
-- Scope boundary: the Ipoh `Kennel.scheduleDayOfWeek` / `scheduleTime` /
-- `scheduleNotes` / `description` fields still say "Saturday" / "5:00 PM"
-- in prisma/seed-data/kennels.ts. That file is owned by the parallel WS4
-- workstream (#1478 — Ipoh profile bundle), which lands after this PR per
-- the coordination plan. Two seams persist until WS4 ships:
--   1. `npx prisma db seed` re-runs Pass 2 of runScheduleRuleBackfill,
--      which would derive a SEED_DATA Saturday/17:00 ScheduleRule from
--      the stale flat kennel fields. The kennel page would then render
--      BOTH the Monday STATIC_SCHEDULE row and the Saturday SEED_DATA
--      row. Vercel deploys don't auto-seed, so prod won't hit this —
--      only developers running seed locally.
--   2. `kennel.description` mentions Saturday and renders on the kennel
--      card/detail surfaces. WS4 rewrites the prose.
--
-- Idempotency: every WHERE clause uses divergence checks (`IS DISTINCT
-- FROM`, not `<>`, so missing JSONB keys are treated as needing repair).
-- Re-applying the migration on an already-corrected DB is a no-op.

BEGIN;

-- Visibility: log when the target rows are absent (fresh / partially-
-- restored / preview DBs). Both Part 1's UPDATE and Part 2's DELETE no-op
-- on missing rows via their WHERE clauses, so a missing-seed run stays
-- safe — RAISE NOTICE just surfaces the situation in deploy logs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Source"
    WHERE name = 'Ipoh H3 Static Schedule' AND type = 'STATIC_SCHEDULE'
  ) THEN
    RAISE NOTICE 'Source "Ipoh H3 Static Schedule" not found — Part 1 UPDATE will no-op (run prisma db seed)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'ipoh-h3') THEN
    RAISE NOTICE 'Kennel "ipoh-h3" not found — Part 2 cleanup will no-op (run prisma db seed)';
  END IF;
END $$;

-- Part 1: converge Source.config to the desired final shape. Field-level
-- merge via `||` preserves any other admin-set keys. The divergence check
-- uses `IS DISTINCT FROM` so a missing JSONB key (e.g. an admin row that
-- never set `defaultDescription`) is treated as needing repair — `<>`
-- would return NULL and the OR-chain would silently skip the row.
UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'rrule', 'FREQ=WEEKLY;BYDAY=MO',
      'startTime', '18:00',
      'defaultDescription',
        'Weekly Monday evening trail (men''s chapter). Founded 31 Jan 1965, one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.'
    ),
    "updatedAt" = NOW()
WHERE name = 'Ipoh H3 Static Schedule'
  AND type = 'STATIC_SCHEDULE'
  AND (
    config->>'rrule' IS DISTINCT FROM 'FREQ=WEEKLY;BYDAY=MO'
    OR config->>'startTime' IS DISTINCT FROM '18:00'
    OR config->>'defaultDescription' IS DISTINCT FROM 'Weekly Monday evening trail (men''s chapter). Founded 31 Jan 1965, one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.'
  );

-- Part 2: cascade-delete ghost Saturday@17:00 Ipoh events, scoped by
-- source provenance so:
--   * manual admin entries (no linked RawEvents) are preserved
--   * events partly driven by a different source are preserved (NOT EXISTS
--     keeps the secondary source's validation intact; if a second source
--     is ever added and a real Saturday@17:00 row needs cleanup, do it
--     via the admin tool with case-by-case judgment)
--
-- Past + upcoming both removed — every Saturday@17:00 Ipoh event the
-- adapter ever emitted was fictional and would poison the kennel heatmap.
--
-- FK-safe ordering mirrors scripts/lib/cascade-delete.ts:
--   1. Capture affected kennel IDs BEFORE delete (multi-kennel co-host
--      events would otherwise leave secondary kennels with stale
--      Kennel.lastEventDate)
--   2. Unlink RawEvent (preserve immutable audit trail; processed=false
--      so a future scrape can re-emit if a real Saturday event arrives)
--   3. Null out parentEventId back-refs
--   4. Delete EventHare / Attendance / KennelAttendance child rows
--   5. Delete Event (EventKennel + EventLink cascade via onDelete:
--      Cascade)
CREATE TEMPORARY TABLE ipoh_ghost_events ON COMMIT DROP AS
SELECT e.id
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
WHERE k."kennelCode" = 'ipoh-h3'
  AND e."startTime" = '17:00'
  AND EXTRACT(DOW FROM e.date) = 6  -- Saturday (Postgres DOW: Sun=0..Sat=6)
  AND EXISTS (
    SELECT 1
    FROM "RawEvent" re
    JOIN "Source" s ON s.id = re."sourceId"
    WHERE re."eventId" = e.id
      AND s.name = 'Ipoh H3 Static Schedule'
      AND s.type = 'STATIC_SCHEDULE'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "RawEvent" re2
    JOIN "Source" s2 ON s2.id = re2."sourceId"
    WHERE re2."eventId" = e.id
      AND (s2.name <> 'Ipoh H3 Static Schedule' OR s2.type <> 'STATIC_SCHEDULE')
  );

-- Every kennel that has an EventKennel row pointing at a doomed event —
-- primary (ipoh-h3) + any co-host secondaries. Captured before the cascade
-- delete so Part 4's lastEventDate refresh covers all of them.
CREATE TEMPORARY TABLE ipoh_affected_kennels ON COMMIT DROP AS
SELECT DISTINCT ek."kennelId"
FROM "EventKennel" ek
WHERE ek."eventId" IN (SELECT id FROM ipoh_ghost_events)
UNION
SELECT DISTINCT e."kennelId"
FROM "Event" e
WHERE e.id IN (SELECT id FROM ipoh_ghost_events);

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

-- Part 3: converge the Ipoh STATIC_SCHEDULE ScheduleRule row to
-- (FREQ=WEEKLY;BYDAY=MO, 18:00). `runScheduleRuleBackfill()` derives
-- ScheduleRule from Source.config only during `prisma db seed`, so prod
-- ScheduleRule rows carry the OLD shape until the next seed run. Kennel
-- pages and Travel Mode (src/lib/travel/search.ts,
-- src/app/kennels/page.tsx) read ScheduleRule directly, so without this
-- repair the kennel keeps rendering as a Saturday@5pm club after deploy.
--
-- Strategy: delete any STATIC_SCHEDULE row that's NOT already the desired
-- shape, then upsert. Converges every state — stale SA row only, partial
-- fix (MO, 17:00), correct row already present, or no row at all — to a
-- single canonical row. The id is a deterministic string so re-runs
-- target the same row key; ScheduleRule.id is opaque to consumers, and
-- the next `prisma db seed` upserts against (kennelId, rrule, source)
-- regardless of id shape (avoids depending on pgcrypto / gen_random_uuid).
-- IS DISTINCT FROM keeps the comparison null-safe for the nullable
-- `startTime` column.
DELETE FROM "ScheduleRule"
WHERE "kennelId" = (SELECT id FROM "Kennel" WHERE "kennelCode" = 'ipoh-h3')
  AND source = 'STATIC_SCHEDULE'
  AND (
    rrule IS DISTINCT FROM 'FREQ=WEEKLY;BYDAY=MO'
    OR "startTime" IS DISTINCT FROM '18:00'
  );

INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source,
  "sourceReference", "lastValidatedAt", "isActive", "createdAt", "updatedAt"
)
SELECT
  'mig_1477_ipoh_static_mo',
  k.id,
  'FREQ=WEEKLY;BYDAY=MO',
  '18:00',
  'HIGH'::"ScheduleConfidence",
  'STATIC_SCHEDULE'::"ScheduleRuleSource",
  'Ipoh H3 Static Schedule',
  NOW(),
  true,
  NOW(),
  NOW()
FROM "Kennel" k
WHERE k."kennelCode" = 'ipoh-h3'
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "startTime" = EXCLUDED."startTime",
  confidence = EXCLUDED.confidence,
  "sourceReference" = EXCLUDED."sourceReference",
  "lastValidatedAt" = EXCLUDED."lastValidatedAt",
  "isActive" = true,
  "updatedAt" = NOW();

-- Part 4: recompute Kennel.lastEventDate for every kennel touched by the
-- deletions (primary + co-host secondaries). merge.ts only moves the
-- cache UP, so deletions otherwise leave it stale until a future scrape
-- pushes the date forward. Predicate matches the canonical invariant in
-- `src/pipeline/backfill-last-event.ts` — exclude `status='CANCELLED'`
-- and `isManualEntry=true` so cancelled / admin-added rows don't keep
-- the cache more recent than the directory and travel surfaces actually
-- consider active.
UPDATE "Kennel"
SET "lastEventDate" = (
  SELECT MAX(date)
  FROM "Event"
  WHERE "kennelId" = "Kennel".id
    AND status <> 'CANCELLED'
    AND "isManualEntry" <> true
)
WHERE id IN (SELECT "kennelId" FROM ipoh_affected_kennels);

COMMIT;
