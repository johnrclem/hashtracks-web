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
