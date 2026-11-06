-- HC batch (Nov 2026) follow-up: Travel Mode schedule rules for 5 kennels whose
-- backfilled Harrier Central history shows a usable pattern. Vercel never runs
-- `db seed`, so these rows ship here (mirrors prisma/seed-data/kennels.ts).
--
--   blhhh    Pass-3 seed rule  FREQ=WEEKLY;INTERVAL=2;BYDAY=SA  MEDIUM  (anchor 2026-10-31)
--   abujah3  Pass-3 seed rule  CADENCE=WEEKLY;BYDAY=SA          LOW     (possible activity)
--   ph3-sr   Pass-2 equivalent FREQ=WEEKLY;BYDAY=MO             MEDIUM  (Kennel flat fields)
--   mobh3    Pass-2 equivalent FREQ=LUNAR                       LOW     (scheduleFrequency → Full Moon)
--   sunh3    Pass-2 equivalent FREQ=LUNAR                       LOW     (scheduleFrequency → Full Moon)
--
-- Idempotent: ON CONFLICT on the (kennelId, rrule, source) upsert key; the
-- frequency UPDATE only touches rows still at the old 'Monthly' value.
-- A missing kennel only RAISEs a NOTICE (keeps the shadow DB usable).

DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['blhhh','abujah3','ph3-sr','mobh3','sunh3']) AS c
  WHERE NOT EXISTS (SELECT 1 FROM "Kennel" k WHERE k."kennelCode" = c);
  IF missing IS NOT NULL THEN
    RAISE NOTICE 'hc_batch_nov_schedule_rules: kennels not found, skipped: %', missing;
  END IF;
END $$;

-- 1. Full-moon kennels: the display frequency becomes "Full Moon" (the convention
--    Pass 2 maps to the FREQ=LUNAR sentinel, as for bos-moon / ggfm / sfm).
UPDATE "Kennel"
SET "scheduleFrequency" = 'Full Moon', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" IN ('mobh3', 'sunh3') AND "scheduleFrequency" = 'Monthly';

-- 2. Pass-3 seed rules (KennelSeed.scheduleRules), source SEED_DATA.
INSERT INTO "ScheduleRule" (id, "kennelId", rrule, "startTime", "anchorDate", confidence, source, "sourceReference", "lastValidatedAt", "isActive", label, "displayOrder", "createdAt", "updatedAt")
SELECT v.id, k.id, v.rrule, v.start_time, v.anchor_date, v.confidence::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", v.source_ref, NOW() AT TIME ZONE 'UTC', true, v.label, 0, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (VALUES
    ('sr_hcnov_blhhh_1', 'blhhh', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '17:00', '2026-10-31', 'MEDIUM', 'Fortnightly Saturday', 'KennelSeed.scheduleRules[blhhh]'),
    ('sr_hcnov_abujah3_1', 'abujah3', 'CADENCE=WEEKLY;BYDAY=SA', '14:30', NULL, 'LOW', 'Saturday afternoon', 'KennelSeed.scheduleRules[abujah3]')
) AS v(id, kennel_code, rrule, start_time, anchor_date, confidence, label, source_ref)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 3. Pass-2 equivalents (derived from Kennel.scheduleDayOfWeek / scheduleFrequency /
--    scheduleTime exactly as scripts/backfill-schedule-rules.ts would), source SEED_DATA.
INSERT INTO "ScheduleRule" (id, "kennelId", rrule, "startTime", "anchorDate", confidence, source, "sourceReference", "lastValidatedAt", "isActive", notes, label, "displayOrder", "createdAt", "updatedAt")
SELECT v.id, k.id, v.rrule, v.start_time, NULL, v.confidence::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource", 'Kennel.scheduleDayOfWeek/Frequency', NULL, true, v.notes, NULL, 0, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (VALUES
    ('sr_hcnov_ph3_sr_1', 'ph3-sr', 'FREQ=WEEKLY;BYDAY=MO', '17:30', 'MEDIUM', NULL),
    ('sr_hcnov_mobh3_1', 'mobh3', 'FREQ=LUNAR', '19:00', 'LOW', 'Full moon schedule'),
    ('sr_hcnov_sunh3_1', 'sunh3', 'FREQ=LUNAR', NULL, 'LOW', 'Full moon schedule')
) AS v(id, kennel_code, rrule, start_time, confidence, notes)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;
