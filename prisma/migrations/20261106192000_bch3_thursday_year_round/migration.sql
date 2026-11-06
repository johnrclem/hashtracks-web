-- BCH3 (Brew City, Milwaukee): Thursdays at 7 PM all year (WS4 / G4, Nov 2026 triage).
--
-- The seeded "Summer Thursday (Jun–Oct) / Winter Friday (Nov–May)" pair was an
-- artifact of Wix rendering BCH3's headings in UTC: a Thursday 7 PM winter run read
-- as "Friday 1 AM" (#2720 fixed the adapter). Travel Mode and the weekly rule-drift
-- cron read ScheduleRule directly, so the correction ships here (Vercel never runs
-- `db seed`). Mirrors prisma/seed-data/kennels.ts.
--
-- DATA-ONLY, idempotent (guarded UPDATEs). A missing kennel only RAISEs a NOTICE.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'bch3') THEN
    RAISE NOTICE 'bch3_thursday_year_round: kennel bch3 not found, skipped';
  END IF;
END $$;

-- 1. Retire the Winter-Friday rule.
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'bch3'
  AND sr.rrule = 'FREQ=WEEKLY;BYDAY=FR' AND sr.source::text = 'SEED_DATA' AND sr."isActive";

-- 2. The Thursday rule becomes year-round at 19:00.
UPDATE "ScheduleRule" sr
SET label = NULL, "validFrom" = NULL, "validUntil" = NULL, "startTime" = '19:00',
    "lastValidatedAt" = NOW() AT TIME ZONE 'UTC', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'bch3'
  AND sr.rrule = 'FREQ=WEEKLY;BYDAY=TH' AND sr.source::text = 'SEED_DATA'
  AND (sr."validFrom" IS NOT NULL OR sr."validUntil" IS NOT NULL OR sr.label IS NOT NULL
       OR sr."startTime" IS DISTINCT FROM '19:00');

-- 3. Profile start time (NULL-fill only).
UPDATE "Kennel"
SET "scheduleTime" = '7:00 PM', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bch3' AND "scheduleTime" IS NULL;
