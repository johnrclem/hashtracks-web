-- SE Asia STATIC_SCHEDULE day/time fixes (#1431, #1535, #1537)
--
-- Three sibling sources to the Ipoh H3 row repaired in
-- 20260520210000_fix_ipoh_h3_schedule_1477 shipped with the same
-- Saturday@17:00 placeholder cut-and-paste from JB/Penang neighbors.
-- Each is actually misinformation on the malaysiahash.com directory:
--   * Kluang H3   — Wednesdays @ 6:00pm  (founded 23 Feb 1967)
--   * Kuching H3  — Tuesdays @ 5:30pm    (founded 21 May 1963)
--   * KK H3       — Mondays @ 4:30pm     (founded 22 Jun 1964)
--
-- The seed file (prisma/seed-data/sources.ts + prisma/seed-data/kennels.ts)
-- has been corrected in this PR; this migration applies the same
-- corrections to the live `Source` rows, repairs the derived ScheduleRule
-- rows, removes the orphan Saturday events, and converges the kennel
-- profile fields. Without it the only path to prod is a manual
-- `npx prisma db seed`, which Vercel does not run.
--
-- Structure mirrors 20260520210000_fix_ipoh_h3_schedule_1477 (source +
-- ScheduleRule + event cleanup) merged with 20260521000000_fix_ipoh_h3_profile_1478
-- (kennel profile fields), one DO block per kennel for auditability.
-- Repetition is intentional: each block carries the kennel-specific
-- constants in its DECLARE section so changes to one kennel can't
-- accidentally affect the others.
--
-- Idempotency: every WHERE clause uses divergence checks (`IS DISTINCT
-- FROM`, not `<>`, so missing JSONB keys are treated as needing repair).
-- Profile-field UPDATEs use COALESCE so admin edits aren't stomped on
-- re-runs. Re-applying the migration on an already-corrected DB is a
-- no-op.

BEGIN;

-- ===== Kluang H3 (#1431): Saturday@17:00 → Wednesday@18:00 =====
DO $$
DECLARE
  -- Identity of the row family being repaired.
  v_kennel_code      text := 'kluang-h3';
  v_source_name      text := 'Kluang H3 Static Schedule';
  v_source_type      text := 'STATIC_SCHEDULE';
  -- Wrong-config shape (the bug we're repairing).
  v_wrong_start_time text := '17:00';
  v_wrong_dow        int  := 6;  -- Saturday (Postgres DOW: Sun=0..Sat=6)
  -- Desired final shape (Source.config).
  v_correct_rrule    text := 'FREQ=WEEKLY;BYDAY=WE';
  v_correct_start    text := '18:00';
  v_correct_descr    text := 'Weekly Wednesday evening trail. Founded 23 Feb 1967, one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.';
  -- Desired final shape (Kennel profile).
  v_dow_label        text := 'Wednesday';
  v_time_label       text := '6:00 PM';
  v_schedule_notes   text := 'Weekly Wednesday runs through the palm oil plantations and jungle trails around Kluang. Founded 23 Feb 1967 by Richard C. A. McAllister.';
  v_kennel_descr     text := 'Founded 23 Feb 1967 in the Johor interior, Kluang H3 predates the larger Johor Bahru kennel by two years. Weekly Wednesday evening runs through the palm oil plantations and jungle trails around Kluang.';
  -- Deterministic ScheduleRule id (avoids pgcrypto / gen_random_uuid).
  v_rule_id          text := 'mig_1431_kluang_static_we';
BEGIN
  IF NOT EXISTS (  -- NOSONAR plsql:S1138 — semi-join is the natural shape for "is the seed row present?"
    SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type
  ) THEN
    RAISE NOTICE 'Source "%" not found — UPDATE will no-op (run prisma db seed)', v_source_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — cleanup will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Part 1: converge Source.config. Kluang URL intentionally unchanged —
  -- the `#kluang` anchor on malaysiahash.com is harmless (lands on the
  -- map homepage), whereas Kuching/KK's `#kuching` / `#kota-kinabalu`
  -- anchors are also dead so those blocks rewrite to the chapter listing.
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

  -- Part 2: cascade-delete ghost Saturday@17:00 events, scoped by source
  -- provenance so manual admin entries and mixed-provenance events are
  -- preserved. Mirrors the Ipoh #1477 strategy.
  CREATE TEMPORARY TABLE kluang_ghost_events ON COMMIT DROP AS
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

  CREATE TEMPORARY TABLE kluang_affected_kennels ON COMMIT DROP AS
  SELECT DISTINCT ek."kennelId"
  FROM "EventKennel" ek
  WHERE ek."eventId" IN (SELECT id FROM kluang_ghost_events)
  UNION
  SELECT DISTINCT e."kennelId"
  FROM "Event" e
  WHERE e.id IN (SELECT id FROM kluang_ghost_events);

  UPDATE "RawEvent"
  SET "eventId" = NULL, processed = false
  WHERE "eventId" IN (SELECT id FROM kluang_ghost_events);

  UPDATE "Event"
  SET "parentEventId" = NULL
  WHERE "parentEventId" IN (SELECT id FROM kluang_ghost_events);

  DELETE FROM "EventHare"        WHERE "eventId" IN (SELECT id FROM kluang_ghost_events);
  DELETE FROM "Attendance"       WHERE "eventId" IN (SELECT id FROM kluang_ghost_events);
  DELETE FROM "KennelAttendance" WHERE "eventId" IN (SELECT id FROM kluang_ghost_events);
  DELETE FROM "Event"            WHERE id        IN (SELECT id FROM kluang_ghost_events);

  -- Part 3: converge ScheduleRule.
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
    v_rule_id, k.id, v_correct_rrule, v_correct_start,
    'HIGH'::"ScheduleConfidence", v_source_type::"ScheduleRuleSource",
    v_source_name, NOW(), true, NOW(), NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime" = EXCLUDED."startTime",
    confidence = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive" = true,
    "updatedAt" = NOW();

  -- Part 4: converge Kennel schedule strings + description (the four
  -- fields the seed merge cannot reach — ensureKennelRecords only fills
  -- NULLs). Mirrors the Ipoh #1478 strategy.
  UPDATE "Kennel"
  SET "scheduleDayOfWeek" = v_dow_label,
      "scheduleTime"      = v_time_label,
      "scheduleNotes"     = v_schedule_notes,
      description         = v_kennel_descr,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleDayOfWeek" IS DISTINCT FROM v_dow_label
      OR "scheduleTime"   IS DISTINCT FROM v_time_label
      OR "scheduleNotes"  IS DISTINCT FROM v_schedule_notes
      OR description      IS DISTINCT FROM v_kennel_descr
    );

  -- Part 5: recompute Kennel.lastEventDate for every kennel touched by
  -- the deletions (primary + co-host secondaries). Predicate intentionally
  -- broader than src/pipeline/backfill-last-event.ts's single-FK MAX: the
  -- affected_kennels set explicitly includes EventKennel secondaries, so a
  -- pure-secondary co-host could be silently downgraded if we only looked
  -- at Event.kennelId. Including EventKennel-linked events guarantees the
  -- cache reflects every event the kennel is actually attached to.
  UPDATE "Kennel"
  SET "lastEventDate" = (
    SELECT MAX(e.date)
    FROM "Event" e
    WHERE (
      e."kennelId" = "Kennel".id
      OR EXISTS (  -- NOSONAR plsql:S1138 — semi-join, no row multiplication
        SELECT 1 FROM "EventKennel" ek
        WHERE ek."eventId" = e.id AND ek."kennelId" = "Kennel".id
      )
    )
    AND e.status::text <> 'CANCELLED'
    AND NOT e."isManualEntry"
  )
  WHERE id IN (SELECT "kennelId" FROM kluang_affected_kennels);
END $$;

-- ===== Kuching H3 (#1535): Saturday@17:00 → Tuesday@17:30 + profile =====
DO $$
DECLARE
  v_kennel_code      text := 'kuching-h3';
  v_source_name      text := 'Kuching H3 Static Schedule';
  v_source_type      text := 'STATIC_SCHEDULE';
  v_wrong_start_time text := '17:00';
  v_wrong_dow        int  := 6;
  v_correct_rrule    text := 'FREQ=WEEKLY;BYDAY=TU';
  v_correct_start    text := '17:30';
  v_correct_descr    text := 'Weekly Tuesday evening trail (men''s chapter). Founded 21 May 1963 by Harry Howell — one of Malaysia''s oldest hash kennels. Check the malaysiahash.com directory for contact details.';
  -- The configured source URL had a dead `#kuching` anchor; the real
  -- chapter listing lives under `?r=chapters&state=Sarawak`. Updating
  -- the human-clickable provenance link in prod too.
  v_correct_url      text := 'https://www.malaysiahash.com/index.php?r=chapters&state=Sarawak';
  v_dow_label        text := 'Tuesday';
  v_time_label       text := '5:30 PM';
  v_schedule_notes   text := 'Weekly Tuesday runs around Kuching in Sarawak (East Malaysia). Founded 21 May 1963 by Harry Howell.';
  v_kennel_descr     text := 'Founded 21 May 1963 in Sarawak (East Malaysia), Kuching H3 is one of the oldest hash kennels in Borneo and among the earliest in Malaysia outside the peninsula. Weekly Tuesday evening trails around Kuching (men''s chapter).';
  v_founder          text := 'Harry Howell';
  v_facebook_url     text := 'https://www.facebook.com/kuchinghashhouseharrier/';
  v_rule_id          text := 'mig_1535_kuching_static_tu';
BEGIN
  IF NOT EXISTS (  -- NOSONAR plsql:S1138
    SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type
  ) THEN
    RAISE NOTICE 'Source "%" not found — UPDATE will no-op (run prisma db seed)', v_source_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — cleanup will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Part 1: converge Source.config + url.
  UPDATE "Source"
  SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
        'rrule', v_correct_rrule,
        'startTime', v_correct_start,
        'defaultDescription', v_correct_descr
      ),
      url = v_correct_url,
      "updatedAt" = NOW()
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND (
      config->>'rrule' IS DISTINCT FROM v_correct_rrule
      OR config->>'startTime' IS DISTINCT FROM v_correct_start
      OR config->>'defaultDescription' IS DISTINCT FROM v_correct_descr
      OR url IS DISTINCT FROM v_correct_url
    );

  -- Part 2: cascade-delete ghost Saturday@17:00 events.
  CREATE TEMPORARY TABLE kuching_ghost_events ON COMMIT DROP AS
  SELECT e.id
  FROM "Event" e
  JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" = v_kennel_code
    AND e."startTime" = v_wrong_start_time
    AND EXTRACT(DOW FROM e.date) = v_wrong_dow
    AND EXISTS (  -- NOSONAR plsql:S1138
      SELECT 1
      FROM "RawEvent" re
      JOIN "Source" s ON s.id = re."sourceId"
      WHERE re."eventId" = e.id
        AND s.name = v_source_name
        AND s.type::text = v_source_type
    )
    AND NOT EXISTS (  -- NOSONAR plsql:S1138
      SELECT 1
      FROM "RawEvent" re2
      JOIN "Source" s2 ON s2.id = re2."sourceId"
      WHERE re2."eventId" = e.id
        AND (s2.name <> v_source_name OR s2.type::text <> v_source_type)
    );

  CREATE TEMPORARY TABLE kuching_affected_kennels ON COMMIT DROP AS
  SELECT DISTINCT ek."kennelId"
  FROM "EventKennel" ek
  WHERE ek."eventId" IN (SELECT id FROM kuching_ghost_events)
  UNION
  SELECT DISTINCT e."kennelId"
  FROM "Event" e
  WHERE e.id IN (SELECT id FROM kuching_ghost_events);

  UPDATE "RawEvent"
  SET "eventId" = NULL, processed = false
  WHERE "eventId" IN (SELECT id FROM kuching_ghost_events);

  UPDATE "Event"
  SET "parentEventId" = NULL
  WHERE "parentEventId" IN (SELECT id FROM kuching_ghost_events);

  DELETE FROM "EventHare"        WHERE "eventId" IN (SELECT id FROM kuching_ghost_events);
  DELETE FROM "Attendance"       WHERE "eventId" IN (SELECT id FROM kuching_ghost_events);
  DELETE FROM "KennelAttendance" WHERE "eventId" IN (SELECT id FROM kuching_ghost_events);
  DELETE FROM "Event"            WHERE id        IN (SELECT id FROM kuching_ghost_events);

  -- Part 3: converge ScheduleRule.
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
    v_rule_id, k.id, v_correct_rrule, v_correct_start,
    'HIGH'::"ScheduleConfidence", v_source_type::"ScheduleRuleSource",
    v_source_name, NOW(), true, NOW(), NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime" = EXCLUDED."startTime",
    confidence = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive" = true,
    "updatedAt" = NOW();

  -- Part 4: converge Kennel schedule strings + description.
  UPDATE "Kennel"
  SET "scheduleDayOfWeek" = v_dow_label,
      "scheduleTime"      = v_time_label,
      "scheduleNotes"     = v_schedule_notes,
      description         = v_kennel_descr,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleDayOfWeek" IS DISTINCT FROM v_dow_label
      OR "scheduleTime"   IS DISTINCT FROM v_time_label
      OR "scheduleNotes"  IS DISTINCT FROM v_schedule_notes
      OR description      IS DISTINCT FROM v_kennel_descr
    );

  -- Part 4b: fill new optional profile fields when currently NULL so a
  -- later admin edit isn't stomped on the next deploy.
  UPDATE "Kennel"
  SET founder       = COALESCE(founder, v_founder),
      "facebookUrl" = COALESCE("facebookUrl", v_facebook_url),
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (founder IS NULL OR "facebookUrl" IS NULL);

  -- Part 5: recompute Kennel.lastEventDate. See Kluang block for predicate
  -- rationale (EventKennel-aware to cover co-host secondaries).
  UPDATE "Kennel"
  SET "lastEventDate" = (
    SELECT MAX(e.date)
    FROM "Event" e
    WHERE (
      e."kennelId" = "Kennel".id
      OR EXISTS (  -- NOSONAR plsql:S1138
        SELECT 1 FROM "EventKennel" ek
        WHERE ek."eventId" = e.id AND ek."kennelId" = "Kennel".id
      )
    )
    AND e.status::text <> 'CANCELLED'
    AND NOT e."isManualEntry"
  )
  WHERE id IN (SELECT "kennelId" FROM kuching_affected_kennels);
END $$;

-- ===== KK H3 (#1537): Saturday@17:00 → Monday@16:30 + profile =====
DO $$
DECLARE
  v_kennel_code      text := 'kk-h3';
  v_source_name      text := 'KK H3 Static Schedule';
  v_source_type      text := 'STATIC_SCHEDULE';
  v_wrong_start_time text := '17:00';
  v_wrong_dow        int  := 6;
  v_correct_rrule    text := 'FREQ=WEEKLY;BYDAY=MO';
  v_correct_start    text := '16:30';
  v_correct_descr    text := 'Weekly Monday afternoon trail (men''s chapter). Founded 22 June 1964 by George Will and Jim Ambler — one of Sabah''s earliest hash kennels. Check the malaysiahash.com directory for contact details.';
  -- Dead `#kota-kinabalu` anchor → state-level chapter listing.
  v_correct_url      text := 'https://www.malaysiahash.com/index.php?r=chapters&state=Sabah';
  v_dow_label        text := 'Monday';
  v_time_label       text := '4:30 PM';
  v_schedule_notes   text := 'Weekly Monday runs through the hills and trails around Kota Kinabalu. Founded 22 June 1964 by George Will and Jim Ambler.';
  v_kennel_descr     text := 'Founded 22 June 1964 in Sabah (East Malaysia), KK H3 is one of the earliest hash kennels in Borneo. Weekly Monday afternoon trails through the hills and trails around Kota Kinabalu (men''s chapter).';
  v_founder          text := 'George Will & Jim Ambler';
  v_rule_id          text := 'mig_1537_kk_static_mo';
BEGIN
  IF NOT EXISTS (  -- NOSONAR plsql:S1138
    SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type
  ) THEN
    RAISE NOTICE 'Source "%" not found — UPDATE will no-op (run prisma db seed)', v_source_name;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — cleanup will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Part 1: converge Source.config + url.
  UPDATE "Source"
  SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
        'rrule', v_correct_rrule,
        'startTime', v_correct_start,
        'defaultDescription', v_correct_descr
      ),
      url = v_correct_url,
      "updatedAt" = NOW()
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND (
      config->>'rrule' IS DISTINCT FROM v_correct_rrule
      OR config->>'startTime' IS DISTINCT FROM v_correct_start
      OR config->>'defaultDescription' IS DISTINCT FROM v_correct_descr
      OR url IS DISTINCT FROM v_correct_url
    );

  -- Part 2: cascade-delete ghost Saturday@17:00 events.
  CREATE TEMPORARY TABLE kk_ghost_events ON COMMIT DROP AS
  SELECT e.id
  FROM "Event" e
  JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" = v_kennel_code
    AND e."startTime" = v_wrong_start_time
    AND EXTRACT(DOW FROM e.date) = v_wrong_dow
    AND EXISTS (  -- NOSONAR plsql:S1138
      SELECT 1
      FROM "RawEvent" re
      JOIN "Source" s ON s.id = re."sourceId"
      WHERE re."eventId" = e.id
        AND s.name = v_source_name
        AND s.type::text = v_source_type
    )
    AND NOT EXISTS (  -- NOSONAR plsql:S1138
      SELECT 1
      FROM "RawEvent" re2
      JOIN "Source" s2 ON s2.id = re2."sourceId"
      WHERE re2."eventId" = e.id
        AND (s2.name <> v_source_name OR s2.type::text <> v_source_type)
    );

  CREATE TEMPORARY TABLE kk_affected_kennels ON COMMIT DROP AS
  SELECT DISTINCT ek."kennelId"
  FROM "EventKennel" ek
  WHERE ek."eventId" IN (SELECT id FROM kk_ghost_events)
  UNION
  SELECT DISTINCT e."kennelId"
  FROM "Event" e
  WHERE e.id IN (SELECT id FROM kk_ghost_events);

  UPDATE "RawEvent"
  SET "eventId" = NULL, processed = false
  WHERE "eventId" IN (SELECT id FROM kk_ghost_events);

  UPDATE "Event"
  SET "parentEventId" = NULL
  WHERE "parentEventId" IN (SELECT id FROM kk_ghost_events);

  DELETE FROM "EventHare"        WHERE "eventId" IN (SELECT id FROM kk_ghost_events);
  DELETE FROM "Attendance"       WHERE "eventId" IN (SELECT id FROM kk_ghost_events);
  DELETE FROM "KennelAttendance" WHERE "eventId" IN (SELECT id FROM kk_ghost_events);
  DELETE FROM "Event"            WHERE id        IN (SELECT id FROM kk_ghost_events);

  -- Part 3: converge ScheduleRule.
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
    v_rule_id, k.id, v_correct_rrule, v_correct_start,
    'HIGH'::"ScheduleConfidence", v_source_type::"ScheduleRuleSource",
    v_source_name, NOW(), true, NOW(), NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime" = EXCLUDED."startTime",
    confidence = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive" = true,
    "updatedAt" = NOW();

  -- Part 4: converge Kennel schedule strings + description.
  UPDATE "Kennel"
  SET "scheduleDayOfWeek" = v_dow_label,
      "scheduleTime"      = v_time_label,
      "scheduleNotes"     = v_schedule_notes,
      description         = v_kennel_descr,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleDayOfWeek" IS DISTINCT FROM v_dow_label
      OR "scheduleTime"   IS DISTINCT FROM v_time_label
      OR "scheduleNotes"  IS DISTINCT FROM v_schedule_notes
      OR description      IS DISTINCT FROM v_kennel_descr
    );

  -- Part 4b: fill founder when NULL.
  UPDATE "Kennel"
  SET founder     = COALESCE(founder, v_founder),
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND founder IS NULL;

  -- Part 5: recompute Kennel.lastEventDate. See Kluang block for predicate
  -- rationale (EventKennel-aware to cover co-host secondaries).
  UPDATE "Kennel"
  SET "lastEventDate" = (
    SELECT MAX(e.date)
    FROM "Event" e
    WHERE (
      e."kennelId" = "Kennel".id
      OR EXISTS (  -- NOSONAR plsql:S1138
        SELECT 1 FROM "EventKennel" ek
        WHERE ek."eventId" = e.id AND ek."kennelId" = "Kennel".id
      )
    )
    AND e.status::text <> 'CANCELLED'
    AND NOT e."isManualEntry"
  )
  WHERE id IN (SELECT "kennelId" FROM kk_affected_kennels);
END $$;

COMMIT;
