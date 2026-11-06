-- WS3 prediction quality (Nov 2026 triage, items C1 + C7): schedule-rule fixes derived from
-- independent event history, rules for kennels onboarded 2026-11-01 → 11-06, the Grand Strand
-- STATIC_SCHEDULE phase fix, and `upcomingOnly` for the SDH3 hareline.
--
-- Seed parity: every ScheduleRule row below is what `runScheduleRuleBackfill` would write on the
-- next `prisma db seed` (generated with the real planner: Pass 3 `planSeedRule` for kennels with
-- seed `scheduleRules`, Pass 2 `parseFrequencyDay` over the prod flat fields for the rest), so
-- a later seed run upserts the same (kennelId, rrule, source) keys and never deactivates them.
-- lastValidatedAt stays NULL on new rows: these rules are validated by the rule-agreement gate in
-- scoreConfidence, not by a synthetic "validated now" stamp (which would boost MEDIUM→HIGH).
--
-- Idempotent: deterministic ids + ON CONFLICT, guarded UPDATEs, JOIN on kennelCode (missing
-- kennels no-op with a NOTICE).

BEGIN;

CREATE TEMP TABLE ws3_rules (
  id text, kennel_code text, rrule text, anchor_date text, start_time text, confidence text,
  source_ref text, notes text, label text, valid_from text, valid_until text, display_order int
) ON COMMIT DROP;

INSERT INTO ws3_rules VALUES
    ('mig_ws3_philly-h3_0', 'philly-h3', 'FREQ=MONTHLY;BYDAY=2SA', NULL, '14:00', 'MEDIUM', 'KennelSeed.scheduleRules[philly-h3]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_philly-h3_1', 'philly-h3', 'FREQ=MONTHLY;BYDAY=4SA', NULL, '14:00', 'MEDIUM', 'KennelSeed.scheduleRules[philly-h3]', NULL, NULL, NULL, NULL, 1),
    ('mig_ws3_bjh3_0', 'bjh3', 'FREQ=MONTHLY;BYDAY=3SA', NULL, NULL, 'MEDIUM', 'KennelSeed.scheduleRules[bjh3]', NULL, 'Saturday afternoon', NULL, NULL, 0),
    ('mig_ws3_bjh3_1', 'bjh3', 'CADENCE=WEEKLY;BYDAY=WE', NULL, NULL, 'LOW', 'KennelSeed.scheduleRules[bjh3]', NULL, 'Wednesday evening (occasional)', NULL, NULL, 1),
    ('mig_ws3_hump-d_0', 'hump-d', 'FREQ=MONTHLY;BYDAY=1WE', NULL, '18:30', 'MEDIUM', 'KennelSeed.scheduleRules[hump-d]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_hump-d_1', 'hump-d', 'FREQ=MONTHLY;BYDAY=3WE', NULL, '18:30', 'MEDIUM', 'KennelSeed.scheduleRules[hump-d]', NULL, NULL, NULL, NULL, 1),
    ('mig_ws3_hockessin_0', 'hockessin', 'FREQ=WEEKLY;BYDAY=WE', NULL, '18:30', 'HIGH', 'KennelSeed.scheduleRules[hockessin]', NULL, 'Summer', '05-01', '09-10', 0),
    ('mig_ws3_hockessin_1', 'hockessin', 'FREQ=WEEKLY;BYDAY=SA', NULL, '15:00', 'HIGH', 'KennelSeed.scheduleRules[hockessin]', NULL, 'Winter', '09-11', '04-30', 1),
    ('mig_ws3_vindobona-h3_0', 'vindobona-h3', 'FREQ=WEEKLY;BYDAY=MO', NULL, '18:30', 'MEDIUM', 'KennelSeed.scheduleRules[vindobona-h3]', NULL, 'Summer (Monday evening)', '04-01', '09-30', 0),
    ('mig_ws3_vindobona-h3_1', 'vindobona-h3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '14:30', 'MEDIUM', 'KennelSeed.scheduleRules[vindobona-h3]', NULL, 'Winter (Sunday afternoon)', '10-01', '03-31', 1),
    ('mig_ws3_oh3-no_0', 'oh3-no', 'FREQ=WEEKLY;BYDAY=MO', NULL, '18:30', 'MEDIUM', 'KennelSeed.scheduleRules[oh3-no]', NULL, 'Summer', '04-01', '09-30', 0),
    ('mig_ws3_oh3-no_1', 'oh3-no', 'FREQ=WEEKLY;BYDAY=SA', NULL, '14:30', 'MEDIUM', 'KennelSeed.scheduleRules[oh3-no]', NULL, 'Winter', '10-01', '03-31', 1),
    ('mig_ws3_oh3-no_2', 'oh3-no', 'FREQ=MONTHLY;BYDAY=-1WE', NULL, '12:00', 'MEDIUM', 'KennelSeed.scheduleRules[oh3-no]', NULL, 'Last-Wednesday lunch run', NULL, NULL, 2),
    ('mig_ws3_berlinh3_0', 'berlinh3', 'FREQ=WEEKLY;BYDAY=SU;BYMONTH=4,5,6,7,8,9,10', NULL, '14:45', 'MEDIUM', 'KennelSeed.scheduleRules[berlinh3]', NULL, 'Summer', NULL, NULL, 0),
    ('mig_ws3_berlinh3_1', 'berlinh3', 'FREQ=WEEKLY;BYDAY=SU;BYMONTH=1,2,3,11,12', NULL, '13:45', 'MEDIUM', 'KennelSeed.scheduleRules[berlinh3]', NULL, 'Winter', NULL, NULL, 1),
    ('mig_ws3_flour-city_0', 'flour-city', 'FREQ=WEEKLY;BYDAY=TH', NULL, '18:09', 'HIGH', 'KennelSeed.scheduleRules[flour-city]', NULL, 'Summer', '04-01', '10-15', 0),
    ('mig_ws3_flour-city_1', 'flour-city', 'FREQ=WEEKLY;BYDAY=SU', NULL, '13:09', 'HIGH', 'KennelSeed.scheduleRules[flour-city]', NULL, 'Winter', '10-16', '03-31', 1),
    ('mig_ws3_ah4_0', 'ah4', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '2026-10-31', '13:00', 'MEDIUM', 'KennelSeed.scheduleRules[ah4]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_kaohsiung-h3_0', 'kaohsiung-h3', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA', '2026-10-31', NULL, 'MEDIUM', 'KennelSeed.scheduleRules[kaohsiung-h3]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_c2h3-gb_0', 'c2h3-gb', 'FREQ=WEEKLY;BYDAY=MO', NULL, '19:00', 'MEDIUM', 'KennelSeed.scheduleRules[c2h3-gb]', NULL, 'Summer', '04-01', '10-24', 0),
    ('mig_ws3_c2h3-gb_1', 'c2h3-gb', 'FREQ=WEEKLY;BYDAY=SU', NULL, '14:30', 'MEDIUM', 'KennelSeed.scheduleRules[c2h3-gb]', NULL, 'Winter', '10-25', '03-31', 1),
    ('mig_ws3_nh3-de_0', 'nh3-de', 'FREQ=MONTHLY;BYDAY=2SA', NULL, '14:00', 'MEDIUM', 'KennelSeed.scheduleRules[nh3-de]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_newch3_0', 'newch3', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU', '2026-10-25', '11:00', 'MEDIUM', 'KennelSeed.scheduleRules[newch3]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_nwh3-moon_0', 'nwh3-moon', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', '2026-11-04', '19:00', 'MEDIUM', 'KennelSeed.scheduleRules[nwh3-moon]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_dh3-oh_0', 'dh3-oh', 'FREQ=MONTHLY;BYDAY=1SA', NULL, NULL, 'MEDIUM', 'KennelSeed.scheduleRules[dh3-oh]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_dh3-oh_1', 'dh3-oh', 'FREQ=MONTHLY;BYDAY=3SA', NULL, NULL, 'MEDIUM', 'KennelSeed.scheduleRules[dh3-oh]', NULL, NULL, NULL, NULL, 1),
    ('mig_ws3_mkh3_0', 'mkh3', 'CADENCE=BIWEEKLY;BYDAY=MO', NULL, '19:00', 'LOW', 'KennelSeed.scheduleRules[mkh3]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_vbikeh3-la_0', 'vbikeh3-la', 'FREQ=MONTHLY;BYDAY=-1SU', NULL, '09:30', 'MEDIUM', 'KennelSeed.scheduleRules[vbikeh3-la]', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_bdh3-uk_p2_0', 'bdh3-uk', 'CADENCE=BIWEEKLY;BYDAY=SU', NULL, '12:00', 'LOW', 'Kennel.scheduleDayOfWeek/Frequency', 'Biweekly without anchor — phase alignment unknown, cannot project specific dates', NULL, NULL, NULL, 0),
    ('mig_ws3_bfmh3-ro_p2_0', 'bfmh3-ro', 'FREQ=LUNAR', NULL, '19:00', 'LOW', 'Kennel.scheduleDayOfWeek/Frequency', 'Full moon schedule', NULL, NULL, NULL, 0),
    ('mig_ws3_bh3-ro_p2_0', 'bh3-ro', 'FREQ=WEEKLY;BYDAY=SU', NULL, '14:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_cambridge-h3_p2_0', 'cambridge-h3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_cebu-h3_p2_0', 'cebu-h3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '14:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_coeh3_p2_0', 'coeh3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_devonport-h3_p2_0', 'devonport-h3', 'FREQ=WEEKLY;BYDAY=MO', NULL, '18:45', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_dh3-cy_p2_0', 'dh3-cy', 'FREQ=WEEKLY;BYDAY=WE', NULL, NULL, 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_essex-h3_p2_0', 'essex-h3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_gh3-gd_p2_0', 'gh3-gd', 'FREQ=WEEKLY;BYDAY=SA', NULL, NULL, 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_h5-gb_p2_0', 'h5-gb', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_jah3_p2_0', 'jah3', 'CADENCE=BIWEEKLY;BYDAY=SU', NULL, NULL, 'LOW', 'Kennel.scheduleDayOfWeek/Frequency', 'Biweekly without anchor — phase alignment unknown, cannot project specific dates', NULL, NULL, NULL, 0),
    ('mig_ws3_malvern-h3_p2_0', 'malvern-h3', 'FREQ=WEEKLY;BYDAY=TU', NULL, '19:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_nh4_p2_0', 'nh4', 'CADENCE=BIWEEKLY;BYDAY=SU', NULL, '11:00', 'LOW', 'Kennel.scheduleDayOfWeek/Frequency', 'Biweekly without anchor — phase alignment unknown, cannot project specific dates', NULL, NULL, NULL, 0),
    ('mig_ws3_nh4-cy_p2_0', 'nh4-cy', 'FREQ=WEEKLY;BYDAY=TU', NULL, '19:15', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_nwh3_p2_0', 'nwh3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_pgh3_p2_0', 'pgh3', 'FREQ=WEEKLY;BYDAY=SA', NULL, NULL, 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_sbh3-ph_p2_0', 'sbh3-ph', 'FREQ=WEEKLY;BYDAY=MO', NULL, '14:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_sh4_p2_0', 'sh4', 'FREQ=WEEKLY;BYDAY=WE', NULL, '19:30', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_surrey-h3_p2_0', 'surrey-h3', 'FREQ=WEEKLY;BYDAY=SU', NULL, '11:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_tamar-h3_p2_0', 'tamar-h3', 'FREQ=WEEKLY;BYDAY=MO', NULL, '19:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_tvh3_p2_0', 'tvh3', 'FREQ=WEEKLY;BYDAY=MO', NULL, '19:15', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_vbh3-la_p2_0', 'vbh3-la', 'FREQ=WEEKLY;BYDAY=SA', NULL, NULL, 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_vh3-la_p2_0', 'vh3-la', 'FREQ=WEEKLY;BYDAY=MO', NULL, '17:30', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_warwick-h3_p2_0', 'warwick-h3', 'FREQ=WEEKLY;BYDAY=MO', NULL, '19:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0),
    ('mig_ws3_wfh3_p2_0', 'wfh3', 'FREQ=WEEKLY;BYDAY=TH', NULL, '19:00', 'MEDIUM', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, NULL, 0);

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT r.kennel_code) INTO v_missing
  FROM ws3_rules r
  WHERE NOT EXISTS (SELECT 1 FROM "Kennel" k WHERE k."kennelCode" = r.kennel_code);  -- NOSONAR plsql:S1138 — anti-join is the natural shape
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'Kennels not found: % — their ScheduleRule rows no-op (run prisma db seed)', v_missing;
  END IF;
END $$;

-- 1. Upsert the rules (mirrors applyUpserts: the UPDATE leaves lastValidatedAt alone).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", notes, "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  r.id, k.id, r.rrule, r.anchor_date, r.start_time, r.confidence::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", r.source_ref, NULL, r.notes, true, r.label,
  r.valid_from, r.valid_until, r.display_order,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM ws3_rules r
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

-- 2. Kennels now declaring seed scheduleRules opt out of Pass 2, so their other active SEED_DATA
--    rules are stale (mirrors deactivateStaleRules): philly-h3/berlinh3/ah4/kaohsiung-h3 weekly
--    Saturday, bjh3 weekly Wednesday, hump-d anchored biweekly.
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id
  AND sr.source = 'SEED_DATA'
  AND sr."isActive"
  AND k."kennelCode" IN (SELECT kennel_code FROM ws3_rules WHERE source_ref LIKE 'KennelSeed.scheduleRules[%')
  AND NOT EXISTS (
    SELECT 1 FROM ws3_rules r WHERE r.kennel_code = k."kennelCode" AND r.rrule = sr.rrule
  );

-- 3. Grand Strand H3: the STATIC_SCHEDULE anchor was one week out of phase with the real
--    (Facebook) runs — Feb 28, Mar 14 … Nov 7 2026 — so it generated the in-between Saturdays.
UPDATE "Source"
SET config = jsonb_set(config::jsonb, '{anchorDate}', '"2026-03-14"'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Grand Strand H3 Static Schedule' AND type = 'STATIC_SCHEDULE'
  AND config->>'anchorDate' = '2026-03-07';

UPDATE "ScheduleRule" sr
SET "anchorDate" = '2026-03-14', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'gsh3'
  AND sr.source = 'STATIC_SCHEDULE' AND sr.rrule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA'
  AND sr."anchorDate" = '2026-03-07';

--    Cancel the upcoming old-phase runs the static source already generated (backed ONLY by
--    STATIC_SCHEDULE rows). Reconcile would cancel them on the next static scrape, but 12+ of
--    them at once trips its mass-cancel guard. Past phantoms (≤10) are left to that reconcile.
UPDATE "Event" e
SET status = 'CANCELLED', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE e."kennelId" = k.id AND k."kennelCode" = 'gsh3'
  AND e.status = 'CONFIRMED'
  AND e."adminCancelledAt" IS NULL
  AND e.date >= (NOW() AT TIME ZONE 'UTC')::date
  AND (e.date::date - DATE '2026-03-07') % 14 = 0
  AND NOT EXISTS (
    SELECT 1 FROM "RawEvent" re JOIN "Source" s ON s.id = re."sourceId"
    WHERE re."eventId" = e.id AND s.type <> 'STATIC_SCHEDULE'
  );

-- 4. SDH3 Hareline drops each run the day after it happens; history.shtml lists it ~a month
--    later. Without upcomingOnly, reconcile cancelled every past San Diego run in that gap.
UPDATE "Source"
SET config = config::jsonb || '{"upcomingOnly": true}'::jsonb, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'SDH3 Hareline' AND type = 'HTML_SCRAPER'
  AND (config->>'upcomingOnly') IS DISTINCT FROM 'true';

COMMIT;
