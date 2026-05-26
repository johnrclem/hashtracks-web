-- Add ScheduleRule rows for LBH3 + MGH4 multi-cadence schedules
-- (follow-up to 20260525120000_fix_profile_round_12 — Codex review on PR #1684).
--
-- The prior migration refreshed descriptions/notes that describe multi-cadence
-- realities (LBH3 = Thursday Spring/Summer + Sunday Fall/Winter; MGH4 = weekly
-- Wednesday + biweekly Saturday), but the flat schedule fields still imply a
-- single-cadence weekly Sunday / biweekly Saturday. `formatSchedule`
-- (src/lib/format.ts) reads ScheduleRule rows first, falling back to the flat
-- fields only when no rules exist — so adding ScheduleRule rows here is what
-- makes the UI display the corrected cadences.
--
-- `runScheduleRuleBackfill` Pass 3 in scripts/backfill-schedule-rules.ts will
-- emit the same (kennelId, rrule, source=SEED_DATA, sourceReference) keys on
-- the next `prisma db seed` — the ON CONFLICT clause makes that safe.
-- Mirrors the Ipoh H3 inline-insert pattern from migration
-- 20260520210000_fix_ipoh_h3_schedule_1477.
--
-- Idempotent: deterministic rule IDs + ON CONFLICT make re-runs no-ops.

BEGIN;

-- ── LBH3 — Thursday (Spring/Summer) + Sunday (Fall/Winter) ───────────────────
DO $$
DECLARE
  v_kennel_code text := 'lbh3';
  v_source_ref  text := 'KennelSeed.scheduleRules[lbh3]';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — ScheduleRule INSERT will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
    RETURN;
  END IF;

  -- Spring/Summer: Thursday evenings (Apr 1 – Sep 30). startTime omitted —
  -- source ("Thursday evening") doesn't pin a specific time.
  INSERT INTO "ScheduleRule" (
    id, "kennelId", rrule, "startTime", confidence, source,
    "sourceReference", "lastValidatedAt", "isActive", label,
    "validFrom", "validUntil", "displayOrder", "createdAt", "updatedAt"
  )
  SELECT
    'mig_1684_lbh3_th_summer',
    k.id,
    'FREQ=WEEKLY;BYDAY=TH',
    NULL,
    'HIGH'::"ScheduleConfidence",
    'SEED_DATA'::"ScheduleRuleSource",
    v_source_ref,
    NOW(),
    true,
    'Spring/Summer',
    '04-01',
    '09-30',
    0,
    NOW(),
    NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime"       = EXCLUDED."startTime",
    confidence        = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive"        = true,
    label             = EXCLUDED.label,
    "validFrom"       = EXCLUDED."validFrom",
    "validUntil"      = EXCLUDED."validUntil",
    "displayOrder"    = EXCLUDED."displayOrder",
    "updatedAt"       = NOW();

  -- Fall/Winter: Sunday mornings 10:00 AM (Oct 1 – Mar 31).
  INSERT INTO "ScheduleRule" (
    id, "kennelId", rrule, "startTime", confidence, source,
    "sourceReference", "lastValidatedAt", "isActive", label,
    "validFrom", "validUntil", "displayOrder", "createdAt", "updatedAt"
  )
  SELECT
    'mig_1684_lbh3_su_winter',
    k.id,
    'FREQ=WEEKLY;BYDAY=SU',
    '10:00',
    'HIGH'::"ScheduleConfidence",
    'SEED_DATA'::"ScheduleRuleSource",
    v_source_ref,
    NOW(),
    true,
    'Fall/Winter',
    '10-01',
    '03-31',
    1,
    NOW(),
    NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime"       = EXCLUDED."startTime",
    confidence        = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive"        = true,
    label             = EXCLUDED.label,
    "validFrom"       = EXCLUDED."validFrom",
    "validUntil"      = EXCLUDED."validUntil",
    "displayOrder"    = EXCLUDED."displayOrder",
    "updatedAt"       = NOW();
END $$;

-- ── MGH4 — weekly Wednesday + biweekly Saturday ──────────────────────────────
DO $$
DECLARE
  v_kennel_code text := 'mgh4';
  v_source_ref  text := 'KennelSeed.scheduleRules[mgh4]';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — ScheduleRule INSERT will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
    RETURN;
  END IF;

  -- Weekly Wednesday. startTime omitted — source doesn't pin a Wednesday time
  -- (the 2 PM flat field referred to the Saturday slot historically).
  INSERT INTO "ScheduleRule" (
    id, "kennelId", rrule, "startTime", confidence, source,
    "sourceReference", "lastValidatedAt", "isActive",
    "displayOrder", "createdAt", "updatedAt"
  )
  SELECT
    'mig_1684_mgh4_we_weekly',
    k.id,
    'FREQ=WEEKLY;BYDAY=WE',
    NULL,
    'HIGH'::"ScheduleConfidence",
    'SEED_DATA'::"ScheduleRuleSource",
    v_source_ref,
    NOW(),
    true,
    0,
    NOW(),
    NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime"       = EXCLUDED."startTime",
    confidence        = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive"        = true,
    "displayOrder"    = EXCLUDED."displayOrder",
    "updatedAt"       = NOW();

  -- Biweekly Saturday 2:00 PM. INTERVAL=2 without anchorDate matches the
  -- approximation of the prior `scheduleFrequency: "Biweekly"` flat field.
  INSERT INTO "ScheduleRule" (
    id, "kennelId", rrule, "startTime", confidence, source,
    "sourceReference", "lastValidatedAt", "isActive",
    "displayOrder", "createdAt", "updatedAt"
  )
  SELECT
    'mig_1684_mgh4_sa_biweekly',
    k.id,
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA',
    '14:00',
    'HIGH'::"ScheduleConfidence",
    'SEED_DATA'::"ScheduleRuleSource",
    v_source_ref,
    NOW(),
    true,
    1,
    NOW(),
    NOW()
  FROM "Kennel" k
  WHERE k."kennelCode" = v_kennel_code
  ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
    "startTime"       = EXCLUDED."startTime",
    confidence        = EXCLUDED.confidence,
    "sourceReference" = EXCLUDED."sourceReference",
    "lastValidatedAt" = EXCLUDED."lastValidatedAt",
    "isActive"        = true,
    "displayOrder"    = EXCLUDED."displayOrder",
    "updatedAt"       = NOW();
END $$;

COMMIT;
