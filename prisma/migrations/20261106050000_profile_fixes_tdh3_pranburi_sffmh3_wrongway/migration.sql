-- Kennel-profile + source-provenance fixes from the Nov 2026 issue sweep.
-- Data-only, idempotent: every UPDATE is guarded on the old value, so a re-run is a no-op.

-- #2477 TDH3 (tdh3-lb): profile day Thursday -> Wednesday. Every biweekly "Throw Down H3"
-- recurrence on the dedicated TDH3 GCal since 2015 starts on a Wednesday; prod history is
-- Wed-dominant (8 of 17 events in the last 365 days; next-most is 2).
UPDATE "Kennel"
SET "scheduleDayOfWeek" = 'Wednesday',
    "description" = 'Long Beach biweekly Wednesday evening hash.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'tdh3-lb'
  AND "scheduleDayOfWeek" = 'Thursday';

-- The derived LOW cadence sentinel follows the profile day (sourceReference
-- "Kennel.scheduleDayOfWeek/Frequency"). Skip if a WE row already exists (unique key).
UPDATE "ScheduleRule" r
SET "rrule" = 'CADENCE=BIWEEKLY;BYDAY=WE',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE r."kennelId" = k."id"
  AND k."kennelCode" = 'tdh3-lb'
  AND r."rrule" = 'CADENCE=BIWEEKLY;BYDAY=TH'
  AND r."source" = 'SEED_DATA'
  AND NOT EXISTS (
    SELECT 1 FROM "ScheduleRule" r2
    WHERE r2."kennelId" = k."id" AND r2."rrule" = 'CADENCE=BIWEEKLY;BYDAY=WE' AND r2."source" = 'SEED_DATA'
  );

-- #2602 Pranburi H3 (psh3-th): official Instagram @pranburihash (null-fill only).
UPDATE "Kennel"
SET "instagramHandle" = 'pranburihash',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'psh3-th'
  AND "instagramHandle" IS NULL;

-- #2297 SFFMH3: facebook.com/sffmh now resolves to an unrelated personal profile. Repoint the
-- STATIC_SCHEDULE provenance URL + placeholder description at the SFH3 "Fully Mooned" listing.
UPDATE "Source"
SET "url" = 'https://www.sfh3.com/runs?kennels=7',
    "config" = jsonb_set("config", '{defaultDescription}',
      '"Monthly full-moon hash. Check sfh3.com for start location and hare details."'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "name" = 'SFFMH3 Static Schedule (Lunar)'
  AND "type" = 'STATIC_SCHEDULE'
  AND "url" = 'https://www.facebook.com/sffmh';

-- #1724 Wrong Way (wrong-way): "1st, 3rd, and 5th Saturday" verified against 12 months of
-- prod — 1st Sat 11/12, 3rd Sat 12/12, 5th Sat 4/4; 17:00 Jun–Sep, 14:00 Oct–May. Replace the
-- Pass-2 LOW biweekly sentinel with six HIGH seasonal rules mirroring kennels.ts.
UPDATE "Kennel"
SET "scheduleNotes" = '1st, 3rd, and 5th Saturday. 2 PM most of the year; 5 PM in summer (Jun–Sep).',
    "description" = 'Phoenix Saturday afternoon hash. 1st, 3rd, and 5th Saturdays at 2 PM (5 PM in summer).',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'wrong-way'
  AND "scheduleNotes" = '1st, 3rd, and 5th Saturday';

UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'wrong-way'
  AND sr.rrule = 'CADENCE=BIWEEKLY;BYDAY=SA' AND sr.source::text = 'SEED_DATA' AND sr."isActive";

INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder",
  "createdAt", "updatedAt"
)
SELECT
  v.id, k.id, v.rrule, v.start_time, 'HIGH'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[wrong-way]',
  NOW() AT TIME ZONE 'UTC', true, v.label, v.valid_from, v.valid_until, v.display_order,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM (
  VALUES
    ('mig_1724_ww_1sa_s', 'FREQ=MONTHLY;BYDAY=1SA;BYMONTH=6,7,8,9',             '17:00', 'Summer (Jun–Sep)', '06-01', '09-30', 0),
    ('mig_1724_ww_3sa_s', 'FREQ=MONTHLY;BYDAY=3SA;BYMONTH=6,7,8,9',             '17:00', 'Summer (Jun–Sep)', '06-01', '09-30', 1),
    ('mig_1724_ww_5sa_s', 'FREQ=MONTHLY;BYDAY=5SA;BYMONTH=6,7,8,9',             '17:00', 'Summer (Jun–Sep)', '06-01', '09-30', 2),
    ('mig_1724_ww_1sa_w', 'FREQ=MONTHLY;BYDAY=1SA;BYMONTH=1,2,3,4,5,10,11,12', '14:00', 'Oct–May',          '10-01', '05-31', 3),
    ('mig_1724_ww_3sa_w', 'FREQ=MONTHLY;BYDAY=3SA;BYMONTH=1,2,3,4,5,10,11,12', '14:00', 'Oct–May',          '10-01', '05-31', 4),
    ('mig_1724_ww_5sa_w', 'FREQ=MONTHLY;BYDAY=5SA;BYMONTH=1,2,3,4,5,10,11,12', '14:00', 'Oct–May',          '10-01', '05-31', 5)
) AS v(id, rrule, start_time, label, valid_from, valid_until, display_order)
JOIN "Kennel" k ON k."kennelCode" = 'wrong-way'
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "startTime"       = EXCLUDED."startTime",
  confidence        = EXCLUDED.confidence,
  "sourceReference" = EXCLUDED."sourceReference",
  label             = EXCLUDED.label,
  "validFrom"       = EXCLUDED."validFrom",
  "validUntil"      = EXCLUDED."validUntil",
  "displayOrder"    = EXCLUDED."displayOrder",
  "isActive"        = true,
  "updatedAt"       = NOW() AT TIME ZONE 'UTC';
