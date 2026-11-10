-- Rule-drift #2837 (2026-11-09): two of the three flagged kennels had wrong schedule rules.
--   beantown: seasonal Sun/Wed windows switched on Oct 1 / May 1, but the kennel switches around
--             Oct 20 / Apr 20 (Sundays ran to Oct 12 2025 and Oct 18 2026; Wednesdays to Apr 15 2026).
--   soh4:     a year-round Monday rule (derived from the flat fields) for a seasonal kennel —
--             Mondays 18:09 Apr–Sep, Saturdays 14:09 Oct–Mar. Also corrects the winter time in
--             scheduleNotes (1:00 PM → 2:09 PM, per every 2026 winter run).
--   nvhhh:    no change — the finding was two same-day Saturday specials plus a beer mile;
--             the Sunday winter runs continue.
--
-- Seed parity: rows match what `planSeedRule` writes for the updated `KennelSeed.scheduleRules`
-- (HIGH confidence, SEED_DATA), keyed on (kennelId, rrule, source), so a later seed upserts the
-- same rows. lastValidatedAt is left alone. Idempotent; missing kennels no-op.

BEGIN;

CREATE TEMP TABLE drift_2837_rules (
  id text, kennel_code text, rrule text, start_time text, label text,
  valid_from text, valid_until text, display_order int
) ON COMMIT DROP;

INSERT INTO drift_2837_rules VALUES
    ('mig_2837_beantown_0', 'beantown', 'FREQ=WEEKLY;BYDAY=SU', '14:30', 'Summer', '04-21', '10-20', 0),
    ('mig_2837_beantown_1', 'beantown', 'FREQ=WEEKLY;BYDAY=WE', '18:30', 'Winter', '10-21', '04-20', 1),
    ('mig_2837_soh4_0', 'soh4', 'FREQ=WEEKLY;BYDAY=MO', '18:09', 'Summer', '04-01', '09-30', 0),
    ('mig_2837_soh4_1', 'soh4', 'FREQ=WEEKLY;BYDAY=SA', '14:09', 'Winter', '10-01', '03-31', 1);

-- 1. Upsert the rules (mirrors applyUpserts: the UPDATE leaves lastValidatedAt alone).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", notes, "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  r.id, k.id, r.rrule, NULL, r.start_time, 'HIGH'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[' || r.kennel_code || ']', NULL, NULL,
  true, r.label, r.valid_from, r.valid_until, r.display_order,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM drift_2837_rules r
JOIN "Kennel" k ON k."kennelCode" = r.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "anchorDate"      = EXCLUDED."anchorDate",
  "startTime"       = EXCLUDED."startTime",
  confidence        = EXCLUDED.confidence,
  "sourceReference" = EXCLUDED."sourceReference",
  notes             = EXCLUDED.notes,
  label             = EXCLUDED.label,
  "validFrom"       = EXCLUDED."validFrom",
  "validUntil"      = EXCLUDED."validUntil",
  "displayOrder"    = EXCLUDED."displayOrder",
  "isActive"        = true,
  "updatedAt"       = NOW() AT TIME ZONE 'UTC';

-- 2. Deactivate any other active SEED_DATA rule for these kennels (mirrors deactivateStaleRules).
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id
  AND sr.source = 'SEED_DATA'
  AND sr."isActive"
  AND k."kennelCode" IN (SELECT kennel_code FROM drift_2837_rules)
  AND NOT EXISTS (
    SELECT 1 FROM drift_2837_rules r WHERE r.kennel_code = k."kennelCode" AND r.rrule = sr.rrule
  );

-- 3. soh4 winter time in the profile notes.
UPDATE "Kennel"
SET "scheduleNotes" = 'Mondays 6:09 PM (Apr-Sep); Saturdays 2:09 PM (Oct-Mar).', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'soh4'
  AND "scheduleNotes" = 'Mondays 6:09 PM (Apr-Sep); Saturdays 1:00 PM (Oct-Mar).';

COMMIT;
