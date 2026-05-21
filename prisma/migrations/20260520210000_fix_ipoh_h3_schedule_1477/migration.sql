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
--
-- Structure: wrapped in a single PL/pgSQL DO block so constants
-- (kennelCode, source name, desired rrule / startTime, etc.) live in one
-- place rather than repeating across the UPDATE / DELETE / INSERT bodies.

BEGIN;

DO $$
DECLARE
  -- Identity of the row family being repaired.
  v_kennel_code      text := 'ipoh-h3';
  v_source_name      text := 'Ipoh H3 Static Schedule';
  v_source_type      text := 'STATIC_SCHEDULE';
  -- Wrong-config shape (the bug we're repairing).
  v_wrong_start_time text := '17:00';
  v_wrong_dow        int  := 6;  -- Saturday (Postgres DOW: Sun=0..Sat=6)
  -- Desired final shape.
  v_correct_rrule    text := 'FREQ=WEEKLY;BYDAY=MO';
  v_correct_start    text := '18:00';
  v_correct_descr    text := 'Weekly Monday evening trail (men''s chapter). Founded 31 Jan 1965, one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.';
  -- Deterministic ScheduleRule id so re-runs target the same row (avoids
  -- pgcrypto / gen_random_uuid dependency on older Postgres).
  v_rule_id          text := 'mig_1477_ipoh_static_mo';
BEGIN
  -- Visibility: log when the target rows are absent (fresh / partially-
  -- restored / preview DBs). All operations below no-op safely on missing
  -- rows via their WHERE clauses; the NOTICE just surfaces the situation.
  IF NOT EXISTS (  -- NOSONAR plsql:S1138 — semi-join is the natural shape for "is the seed row present?"
    SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type
  ) THEN
    RAISE NOTICE 'Source "%" not found — Part 1 UPDATE will no-op (run prisma db seed)', v_source_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — Part 2 cleanup will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Part 1: converge Source.config to the desired final shape. Field-level
  -- merge via `||` preserves any other admin-set keys. Divergence check uses
  -- `IS DISTINCT FROM` so missing JSONB keys (e.g. an admin row that never
  -- set `defaultDescription`) are treated as needing repair — `<>` would
  -- return NULL and the OR-chain would silently skip the row.
  UPDATE "Source"
  SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
        'rrule', v_correct_rrule,
        'startTime', v_correct_start,
        'defaultDescription', v_correct_descr
      ),
      "updatedAt" = NOW()
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND (
      config->>'rrule' IS DISTINCT FROM v_correct_rrule
      OR config->>'startTime' IS DISTINCT FROM v_correct_start
      OR config->>'defaultDescription' IS DISTINCT FROM v_correct_descr
    );

  -- Part 2: cascade-delete ghost Saturday@17:00 Ipoh events, scoped by
  -- source provenance so manual admin entries (no linked RawEvents) and
  -- events partly driven by a different source survive. If a second
  -- source is ever added and a real Saturday@17:00 row needs cleanup,
  -- do it via the admin tool with case-by-case judgment.
  --
  -- Past + upcoming both removed — every Saturday@17:00 Ipoh event the
  -- adapter ever emitted was fictional and would poison the kennel
  -- heatmap.
  --
  -- FK-safe ordering mirrors scripts/lib/cascade-delete.ts:
  --   1. Capture affected kennel IDs BEFORE delete (multi-kennel co-host
  --      events would otherwise leave secondary kennels with stale
  --      Kennel.lastEventDate)
  --   2. Unlink RawEvent (preserve immutable audit trail; processed=false
  --      so a future scrape can re-emit if a real Saturday event arrives)
  --   3. Null out parentEventId back-refs
  --   4. Delete EventHare / Attendance / KennelAttendance child rows
  --   5. Delete Event (EventKennel + EventLink cascade via
  --      onDelete: Cascade — both relations declare it in schema.prisma)
  CREATE TEMPORARY TABLE ipoh_ghost_events ON COMMIT DROP AS
  SELECT e.id
  FROM "Event" e
  JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" = v_kennel_code
    AND e."startTime" = v_wrong_start_time
    AND EXTRACT(DOW FROM e.date) = v_wrong_dow
    AND EXISTS (  -- NOSONAR plsql:S1138 — semi-join, no row multiplication
      SELECT 1
      FROM "RawEvent" re
      JOIN "Source" s ON s.id = re."sourceId"
      WHERE re."eventId" = e.id
        AND s.name = v_source_name
        AND s.type::text = v_source_type
    )
    AND NOT EXISTS (  -- NOSONAR plsql:S1138 — anti-join, can't be expressed as JOIN
      SELECT 1
      FROM "RawEvent" re2
      JOIN "Source" s2 ON s2.id = re2."sourceId"
      WHERE re2."eventId" = e.id
        AND (s2.name <> v_source_name OR s2.type::text <> v_source_type)
    );

  -- Every kennel attached to a doomed event — primary plus any co-host
  -- secondaries. Captured before the cascade-delete so the
  -- lastEventDate refresh below covers all of them.
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
  -- (rrule=v_correct_rrule, startTime=v_correct_start).
  -- `runScheduleRuleBackfill()` derives ScheduleRule from Source.config
  -- only during `prisma db seed`, so prod ScheduleRule rows carry the OLD
  -- shape until the next seed run. Kennel pages and Travel Mode read
  -- ScheduleRule directly, so without this repair the kennel keeps
  -- rendering as a Saturday@5pm club after deploy.
  --
  -- Strategy: delete any STATIC_SCHEDULE row that's NOT the desired
  -- shape, then upsert. Converges every state — stale SA row, partial
  -- fix, correct row already present, or no row at all — to a single
  -- canonical row. IS DISTINCT FROM keeps the comparison null-safe for
  -- the nullable `startTime` column.
  DELETE FROM "ScheduleRule"
  WHERE "kennelId" = (SELECT id FROM "Kennel" WHERE "kennelCode" = v_kennel_code)
    AND source::text = v_source_type
    AND (
      rrule IS DISTINCT FROM v_correct_rrule
      OR "startTime" IS DISTINCT FROM v_correct_start
    );

  INSERT INTO "ScheduleRule" (
    id, "kennelId", rrule, "startTime", confidence, source,
    "sourceReference", "lastValidatedAt", "isActive", "createdAt", "updatedAt"
  )
  SELECT
    v_rule_id,
    k.id,
    v_correct_rrule,
    v_correct_start,
    'HIGH'::"ScheduleConfidence",
    v_source_type::"ScheduleRuleSource",
    v_source_name,
    NOW(),
    true,
    NOW(),
    NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime" = EXCLUDED."startTime",
    confidence = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive" = true,
    "updatedAt" = NOW();

  -- Part 4: recompute Kennel.lastEventDate for every kennel touched by
  -- the deletions (primary + co-host secondaries). merge.ts only moves
  -- the cache UP, so deletions otherwise leave it stale until a future
  -- scrape pushes the date forward. Predicate matches the canonical
  -- invariant in `src/pipeline/backfill-last-event.ts`: exclude
  -- CANCELLED rows and manual entries so cancelled / admin-added rows
  -- don't keep the cache more recent than the directory and travel
  -- surfaces actually consider active.
  UPDATE "Kennel"
  SET "lastEventDate" = (
    SELECT MAX(date)
    FROM "Event"
    WHERE "kennelId" = "Kennel".id
      AND status::text <> 'CANCELLED'
      AND NOT "isManualEntry"
  )
  WHERE id IN (SELECT "kennelId" FROM ipoh_affected_kennels);
END $$;

COMMIT;
