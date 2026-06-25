-- Desert H3 (dh3-ae) mixed per-weekday cadence — #2310 / docs/prediction-mixed-cadence-proposal.md
--
-- DATA-ONLY. `ensureKennelRecords` only NULL-fills existing kennels and Vercel runs
-- `prisma migrate deploy` (never `db seed`), so the new ScheduleRule rows are applied
-- here so the feature actually ships on deploy (Travel Mode + the rule-drift cron read
-- ScheduleRule directly). Mirrors the kennels.ts `scheduleRules` for dh3-ae EXACTLY so a
-- future manual `db seed` (Pass 3) converges to the same rows. Idempotent (ON CONFLICT) —
-- re-applying on an already-seeded DB is a no-op.
--
-- dh3-ae runs ~weekly but the day alternates: Monday evening (dominant — MEDIUM dated
-- rule, 4 projected Mondays per 4-week window) ⇄ occasional Sunday afternoon (LOW
-- CADENCE sentinel → "possible activity", date=null, NEVER snapshotted, so it cannot
-- pollute prediction precision). The interim #2294 seed produced only the Pass-2 MEDIUM
-- Monday rule (sourceReference "Kennel.scheduleDayOfWeek/Frequency", no label); this
-- enriches that Monday row to the seed shape and adds the Sunday sentinel.

BEGIN;

INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  v.id, k.id, v.rrule, v.start_time, v.confidence::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", v.source_ref, NOW(), true,
  v.label, v.valid_from, v.valid_until, v.display_order, NOW(), NOW()
FROM (
  VALUES
    ('mig_2310_dh3ae_mo', 'dh3-ae', 'FREQ=WEEKLY;BYDAY=MO',    '19:00', 'MEDIUM', 'Monday evening (most weeks)',      NULL, NULL, 0, 'KennelSeed.scheduleRules[dh3-ae]'),
    ('mig_2310_dh3ae_su', 'dh3-ae', 'CADENCE=WEEKLY;BYDAY=SU', NULL,    'LOW',    'Sunday afternoon (cooler months)', NULL, NULL, 1, 'KennelSeed.scheduleRules[dh3-ae]')
) AS v(id, kennel_code, rrule, start_time, confidence, label, valid_from, valid_until, display_order, source_ref)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "startTime"       = EXCLUDED."startTime",
  confidence        = EXCLUDED.confidence,
  "sourceReference" = EXCLUDED."sourceReference",
  label             = EXCLUDED.label,
  "validFrom"       = EXCLUDED."validFrom",
  "validUntil"      = EXCLUDED."validUntil",
  "displayOrder"    = EXCLUDED."displayOrder",
  "isActive"        = true,
  "updatedAt"       = NOW();

COMMIT;
