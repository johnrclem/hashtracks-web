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
-- Single INSERT keeps the SQL DRY (SonarCloud duplication gate).

BEGIN;

-- Surface missing-kennel situations (fresh / partially-restored / preview DBs).
-- The INSERT below already no-ops via the JOIN, but a NOTICE makes the cause
-- visible in deploy logs.
DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT ARRAY_AGG(c) INTO v_missing
  FROM unnest(ARRAY['lbh3', 'mgh4']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = c);  -- NOSONAR plsql:S1138 — anti-join is the natural shape
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'Kennels not found: % — ScheduleRule INSERT will no-op for them (run prisma db seed)', v_missing;  -- NOSONAR plsql:S1192
  END IF;
END $$;

-- All four new rules in one INSERT. The VALUES table is the only place that
-- carries per-rule data; the column list + ON CONFLICT clause are shared.
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source,
  "sourceReference", "lastValidatedAt", "isActive", label,
  "validFrom", "validUntil", "displayOrder", "createdAt", "updatedAt"
)
SELECT
  v.id,
  k.id,
  v.rrule,
  v.start_time,
  'HIGH'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource",
  v.source_ref,
  NOW(),
  true,
  v.label,
  v."validFrom",
  v."validUntil",
  v.display_order,
  NOW(),
  NOW()
FROM (
  VALUES
    -- LBH3 — Thursday evenings Apr–Sep (Spring/Summer). startTime omitted —
    -- source ("Thursday evening") doesn't pin a specific time.
    ('mig_1684_lbh3_th_summer', 'lbh3', 'FREQ=WEEKLY;BYDAY=TH', NULL,    'Spring/Summer', '04-01', '09-30', 0, 'KennelSeed.scheduleRules[lbh3]'),
    -- LBH3 — Sunday mornings 10 AM Oct–Mar (Fall/Winter).
    ('mig_1684_lbh3_su_winter', 'lbh3', 'FREQ=WEEKLY;BYDAY=SU', '10:00', 'Fall/Winter',   '10-01', '03-31', 1, 'KennelSeed.scheduleRules[lbh3]'),
    -- MGH4 — weekly Wednesday. startTime omitted (2 PM flat field referred to
    -- the Saturday slot historically, no Wednesday time on record).
    ('mig_1684_mgh4_we_weekly',  'mgh4', 'FREQ=WEEKLY;BYDAY=WE',             NULL,    NULL, NULL, NULL, 0, 'KennelSeed.scheduleRules[mgh4]'),
    -- MGH4 — biweekly Saturday 2 PM. INTERVAL=2 without anchorDate matches the
    -- approximation of the prior scheduleFrequency: "Biweekly" flat field.
    ('mig_1684_mgh4_sa_biweekly','mgh4', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '14:00', NULL, NULL, NULL, 1, 'KennelSeed.scheduleRules[mgh4]')
) AS v(id, kennel_code, rrule, start_time, label, "validFrom", "validUntil", display_order, source_ref)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
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

COMMIT;
