-- Schedule-rule corrections: #2270 (SWH3, Sydney H3), #1724 (rch3), #1723 (chh3, colh3).
--
-- DATA-ONLY. `prisma/seed.ts` `ensureKennelRecords` only NULL-fills existing kennels,
-- and Vercel runs `prisma migrate deploy` (never `db seed`), so ScheduleRule changes
-- and the colh3 STATIC_SCHEDULE source restructure are applied here. Travel Mode and the
-- weekly rule-drift cron read ScheduleRule directly. All statements are idempotent
-- (guards + ON CONFLICT), so re-applying on an already-corrected DB is a no-op.

BEGIN;

-- ─── #2270 SWH3 (swh3): mixed-weekend, not single-Saturday ──────────────────────
-- 18mo non-cancelled: Sat 21 / Sun 12; recent 6mo Sat 12 / Sun 9 — runs ~weekly but
-- the day alternates Sat/Sun with no clean shift, so the single HIGH Saturday rule kept
-- tripping the 42-day drift detector during Sunday clusters. The seed now sets
-- "Saturday / Sunday" + "Biweekly" (no scheduleRules), so backfill Pass-2 re-derives LOW
-- Sat/Sun CADENCE sentinels on the next manual seed (empty predictedDays → drift clears,
-- no over-projection). Until then this kennel projects nothing; its real source events
-- still drive actual trails. Deactivate the stale HIGH Saturday rule here.
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW()
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'swh3'
  AND sr.rrule = 'FREQ=WEEKLY;BYDAY=SA' AND sr.source::text = 'SEED_DATA' AND sr."isActive";

-- ─── #2270 Sydney H3 (sh3-au): Tuesday → Monday ─────────────────────────────────
-- Live source (sh3.link) states "every Monday 6:30pm"; prod recent Mon 6 / Tue 3.
-- Deactivate the stale TU rule (the MO rule is inserted in the batch below).
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW()
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'sh3-au'
  AND sr.rrule = 'FREQ=WEEKLY;BYDAY=TU' AND sr.source::text = 'SEED_DATA' AND sr."isActive";

-- ─── Deactivate superseded rules for rch3 (#1724), chh3 + colh3 (#1723) ─────────
-- rch3/chh3: LOW CADENCE sentinels Pass-2 derived from the flat fields, replaced by the
-- explicit HIGH rules below. colh3: the no-BYMONTH STATIC_SCHEDULE rules, replaced by the
-- four seasonal BYMONTH rules below (which the seed's matching scheduleRules will absorb
-- on the next manual seed).
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW()
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND sr."isActive" AND (
  (k."kennelCode" = 'rch3'  AND sr.rrule = 'CADENCE=BIWEEKLY;BYDAY=SA' AND sr.source::text = 'SEED_DATA') OR
  (k."kennelCode" = 'chh3'  AND sr.rrule = 'CADENCE=BIWEEKLY;BYDAY=SA' AND sr.source::text = 'SEED_DATA') OR
  (k."kennelCode" = 'colh3' AND sr.rrule IN ('FREQ=MONTHLY;BYDAY=1SU', 'FREQ=MONTHLY;BYDAY=3SU') AND sr.source::text = 'STATIC_SCHEDULE')
);

-- ─── Insert the corrected rules (Sydney MO; rch3 ×4; chh3 ×4 BYMONTH; colh3 ×4 BYMONTH) ─
-- All SEED_DATA, mirroring the kennels.ts scheduleRules exactly so a future manual seed
-- converges. Deterministic ids keep re-application safe.
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
    -- #2270 Sydney H3
    ('mig_2270_sh3au_mo',  'sh3-au', 'FREQ=WEEKLY;BYDAY=MO',  '18:30', 'MEDIUM', NULL,                NULL,    NULL,    0, 'KennelSeed.scheduleRules[sh3-au]'),
    -- #1724 rch3 (2nd/4th Sat year-round @ 3 PM; 1st/3rd Thu summer @ 6:30 PM)
    ('mig_1724_rch3_2sa',  'rch3',  'FREQ=MONTHLY;BYDAY=2SA', '15:00', 'HIGH',   NULL,                NULL,    NULL,    0, 'KennelSeed.scheduleRules[rch3]'),
    ('mig_1724_rch3_4sa',  'rch3',  'FREQ=MONTHLY;BYDAY=4SA', '15:00', 'HIGH',   NULL,                NULL,    NULL,    1, 'KennelSeed.scheduleRules[rch3]'),
    ('mig_1724_rch3_1th',  'rch3',  'FREQ=MONTHLY;BYDAY=1TH', '18:30', 'HIGH',   'Summer',            '05-01', '09-30', 2, 'KennelSeed.scheduleRules[rch3]'),
    ('mig_1724_rch3_3th',  'rch3',  'FREQ=MONTHLY;BYDAY=3TH', '18:30', 'HIGH',   'Summer',            '05-01', '09-30', 3, 'KennelSeed.scheduleRules[rch3]'),
    -- #1723 chh3 (2nd/4th Sat; 4 PM summer Jun–Aug / 2 PM winter)
    ('mig_1723_chh3_2sa_s', 'chh3', 'FREQ=MONTHLY;BYDAY=2SA;BYMONTH=6,7,8',               '16:00', 'HIGH', 'Summer (Jun–Aug)', NULL, NULL, 0, 'KennelSeed.scheduleRules[chh3]'),
    ('mig_1723_chh3_4sa_s', 'chh3', 'FREQ=MONTHLY;BYDAY=4SA;BYMONTH=6,7,8',               '16:00', 'HIGH', 'Summer (Jun–Aug)', NULL, NULL, 1, 'KennelSeed.scheduleRules[chh3]'),
    ('mig_1723_chh3_2sa_w', 'chh3', 'FREQ=MONTHLY;BYDAY=2SA;BYMONTH=1,2,3,4,5,9,10,11,12', '14:00', 'HIGH', 'Winter (Sep–May)', NULL, NULL, 2, 'KennelSeed.scheduleRules[chh3]'),
    ('mig_1723_chh3_4sa_w', 'chh3', 'FREQ=MONTHLY;BYDAY=4SA;BYMONTH=1,2,3,4,5,9,10,11,12', '14:00', 'HIGH', 'Winter (Sep–May)', NULL, NULL, 3, 'KennelSeed.scheduleRules[chh3]'),
    -- #1723 colh3 (1st/3rd Sun; 5 PM summer Apr–Sep / 3 PM winter Oct–Mar)
    ('mig_1723_colh3_1su_s', 'colh3', 'FREQ=MONTHLY;BYDAY=1SU;BYMONTH=4,5,6,7,8,9',   '17:00', 'HIGH', 'Summer (Apr–Sep)', '04-01', '09-30', 0, 'KennelSeed.scheduleRules[colh3]'),
    ('mig_1723_colh3_3su_s', 'colh3', 'FREQ=MONTHLY;BYDAY=3SU;BYMONTH=4,5,6,7,8,9',   '17:00', 'HIGH', 'Summer (Apr–Sep)', '04-01', '09-30', 1, 'KennelSeed.scheduleRules[colh3]'),
    ('mig_1723_colh3_1su_w', 'colh3', 'FREQ=MONTHLY;BYDAY=1SU;BYMONTH=1,2,3,10,11,12', '15:00', 'HIGH', 'Winter (Oct–Mar)', '10-01', '03-31', 2, 'KennelSeed.scheduleRules[colh3]'),
    ('mig_1723_colh3_3su_w', 'colh3', 'FREQ=MONTHLY;BYDAY=3SU;BYMONTH=1,2,3,10,11,12', '15:00', 'HIGH', 'Winter (Oct–Mar)', '10-01', '03-31', 3, 'KennelSeed.scheduleRules[colh3]')
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

-- ─── #1723 colh3 STATIC_SCHEDULE source restructure (seasonal event times) ───────
-- ColH3 runs 1st & 3rd Sunday year-round but 3 PM winter / 5 PM summer. A STATIC_SCHEDULE
-- source carries one startTime, so the seasonal time needs four sources. Make the two
-- existing (un-suffixed) sources the WINTER pair (BYMONTH-gated to Oct–Mar, keep 15:00),
-- and add two SUMMER sources (Apr–Sep @ 17:00). generateOccurrences filters dates by
-- BYMONTH so a given Sunday generates from exactly one source.
UPDATE "Source"
SET config = jsonb_set(config, '{rrule}', '"FREQ=MONTHLY;BYDAY=1SU;BYMONTH=1,2,3,10,11,12"'::jsonb), "updatedAt" = NOW()
WHERE name = 'Columbian H3 Static Schedule (1st Sunday)' AND type::text = 'STATIC_SCHEDULE'
  AND config->>'rrule' IS DISTINCT FROM 'FREQ=MONTHLY;BYDAY=1SU;BYMONTH=1,2,3,10,11,12';
UPDATE "Source"
SET config = jsonb_set(config, '{rrule}', '"FREQ=MONTHLY;BYDAY=3SU;BYMONTH=1,2,3,10,11,12"'::jsonb), "updatedAt" = NOW()
WHERE name = 'Columbian H3 Static Schedule (3rd Sunday)' AND type::text = 'STATIC_SCHEDULE'
  AND config->>'rrule' IS DISTINCT FROM 'FREQ=MONTHLY;BYDAY=3SU;BYMONTH=1,2,3,10,11,12';

INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "healthStatus", "scrapeDays", enabled, "createdAt", "updatedAt")
VALUES
  ('src_1723_colh3_1su_su', 'Columbian H3 Static Schedule (1st Sunday, Summer)',
   'https://www.facebook.com/groups/columbianh3/#1st-sunday-summer', 'STATIC_SCHEDULE'::"SourceType",
   '{"kennelTag":"colh3","rrule":"FREQ=MONTHLY;BYDAY=1SU;BYMONTH=4,5,6,7,8,9","anchorDate":"2026-04-05","startTime":"17:00","titleTemplate":"ColH3 — 1st Sunday Hash","defaultLocation":"Columbia, SC","defaultDescription":"1st & 3rd Sunday trail. Check Facebook for start location."}'::jsonb,
   3, 'weekly', 'UNKNOWN'::"SourceHealth", 90, true, NOW(), NOW()),
  ('src_1723_colh3_3su_su', 'Columbian H3 Static Schedule (3rd Sunday, Summer)',
   'https://www.facebook.com/groups/columbianh3/#3rd-sunday-summer', 'STATIC_SCHEDULE'::"SourceType",
   '{"kennelTag":"colh3","rrule":"FREQ=MONTHLY;BYDAY=3SU;BYMONTH=4,5,6,7,8,9","anchorDate":"2026-04-19","startTime":"17:00","titleTemplate":"ColH3 — 3rd Sunday Hash","defaultLocation":"Columbia, SC","defaultDescription":"1st & 3rd Sunday trail. Check Facebook for start location."}'::jsonb,
   3, 'weekly', 'UNKNOWN'::"SourceHealth", 90, true, NOW(), NOW())
ON CONFLICT (name, type) DO NOTHING;

-- Link the two new summer sources to colh3 (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT v.id, s.id, k.id
FROM (
  VALUES
    ('sk_1723_colh3_1su_su', 'Columbian H3 Static Schedule (1st Sunday, Summer)'),
    ('sk_1723_colh3_3su_su', 'Columbian H3 Static Schedule (3rd Sunday, Summer)')
) AS v(id, source_name)
JOIN "Source" s ON s.name = v.source_name AND s.type::text = 'STATIC_SCHEDULE'
JOIN "Kennel" k ON k."kennelCode" = 'colh3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
