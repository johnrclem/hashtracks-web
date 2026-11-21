-- Seed → prod drift repair (2026-11-20 sweep).
--
-- A read-only sweep comparing prisma/seed-data with prod found seed changes
-- that never reached prod. Their PRs relied on a manual post-merge prod
-- update instead of a data migration (seed changes reach prod only through
-- migrations; Vercel never runs `db seed`). The seed files already carry
-- every value below, apart from the seed additions listed further down, so
-- a fresh DB lands identical.
--
--   1. GATR H3 (#2645): add "GATR H3 WordPress Trail Posts" and retire the
--      static schedule into it. The real blog dates (live-verified: 17 trails,
--      2025-09..2026-11) are varied Saturdays, not the 3rd Saturday, so
--      delete the 14 static-only placeholder events and deactivate the
--      3rd-Saturday Travel rule.
--   2. MGH4 & W3H3 (#2646): add "MGH4 & W3H3 Next Hash" (upcomingOnly). The
--      static schedules stay as the backbone, as that PR intended.
--   3. JB H3 (#2651): Saturday → Wednesday, verified on facebook.com/tjbhhh.
--      Update the source config, delete the 56 Saturday placeholders, and
--      move the Travel rule and the kennel schedule text to Wednesday.
--   4. Hebe H3 (#2651): 1st Saturday → 3rd Saturday. Update the source
--      config, delete the 13 1st-Saturday placeholders, and move the Travel
--      rule and the kennel notes to the 3rd Saturday.
--   5. Retire prod sources the seed dropped, which duplicate a sibling:
--      "MGH4 Static Schedule" (split in May), "Kowloon H3 Static Schedule"
--      (replaced by the sheet in April) and "Rumson Weekly Runs (Static
--      Recurring)" (an admin-made copy of the seeded Rumson schedule).
--      Retire them with `replacedById`, never delete; their RawEvents stay.
--      Kowloon's active STATIC_SCHEDULE Travel rule (weekly Monday) is left as
--      is: its day is right. Rumson's new events will use the seeded title
--      ("Rumson H3 Weekly Run") instead of the admin copy's text.
--
-- Placeholder deletes follow the provenance scoping of
-- 20260521020000_fix_se_asia_static_schedules. An event is deleted only
-- when every one of its raws comes from the one static source being fixed.
-- No deleted event has attendance, kennel attendance or hares (checked
-- 2026-11-20).
--
-- Idempotent: inserts use ON CONFLICT, updates use IS DISTINCT FROM guards,
-- and re-running finds no placeholders left to delete.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- ===== 1 + 2. Missing sources =====
INSERT INTO "Source" (id, name, url, type, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_gatr_h3_wordpress', 'GATR H3 WordPress Trail Posts', 'https://gatrh3.wordpress.com/',
        'HTML_SCRAPER'::"SourceType", 7, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "Source" (id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays", enabled, "healthStatus", "createdAt", "updatedAt")
VALUES ('src_mgh4_w3h3_next_hash', 'MGH4 & W3H3 Next Hash', 'https://mgh4.com/page/next-hash',
        'HTML_SCRAPER'::"SourceType", '{"upcomingOnly": true}'::jsonb, 7, 'daily', 90, true, 'UNKNOWN'::"SourceHealth",
        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_drift_' || t.code || '_' || t.tag, s.id, k.id
FROM (VALUES
  ('GATR H3 WordPress Trail Posts', 'gatr-h3', 'gatrwp'),
  ('MGH4 & W3H3 Next Hash', 'mgh4', 'mgh4nh'),
  ('MGH4 & W3H3 Next Hash', 'w3h3-ga', 'mgh4nh')
) AS t(source_name, code, tag)
JOIN "Source" s ON s.name = t.source_name AND s.type = 'HTML_SCRAPER'::"SourceType"
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- ===== 1. GATR: retire the static schedule into the WordPress source =====
UPDATE "Source" st
SET enabled = false,
    "replacedById" = wp.id,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Source" wp
WHERE st.name = 'GATR H3 Static Schedule' AND st.type = 'STATIC_SCHEDULE'::"SourceType"
  AND wp.name = 'GATR H3 WordPress Trail Posts' AND wp.type = 'HTML_SCRAPER'::"SourceType"
  AND (st.enabled OR st."replacedById" IS DISTINCT FROM wp.id);

UPDATE "ScheduleRule" r
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE r."kennelId" = k.id AND k."kennelCode" = 'gatr-h3'
  AND r.rrule = 'FREQ=MONTHLY;BYDAY=3SA' AND r.source = 'STATIC_SCHEDULE'::"ScheduleRuleSource"
  AND r."isActive";

-- ===== 3. JB H3: Saturday -> Wednesday =====
UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'rrule', 'FREQ=WEEKLY;BYDAY=WE',
      'defaultDescription', 'Weekly Wednesday evening trail. Founded 1969, the oldest hash kennel in Johor (original JBHHH). See Facebook page at facebook.com/tjbhhh for trail details.'
    ),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'JB H3 Static Schedule' AND type = 'STATIC_SCHEDULE'::"SourceType"
  AND (config->>'rrule' IS DISTINCT FROM 'FREQ=WEEKLY;BYDAY=WE'
       OR config->>'defaultDescription' IS DISTINCT FROM 'Weekly Wednesday evening trail. Founded 1969, the oldest hash kennel in Johor (original JBHHH). See Facebook page at facebook.com/tjbhhh for trail details.');

UPDATE "ScheduleRule" r
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE r."kennelId" = k.id AND k."kennelCode" = 'jb-h3'
  AND r.rrule = 'FREQ=WEEKLY;BYDAY=SA' AND r."isActive";

INSERT INTO "ScheduleRule" (id, "kennelId", rrule, "startTime", confidence, source, "sourceReference", "lastValidatedAt", "isActive", "createdAt", "updatedAt")
SELECT 'mig_drift_jbh3_static_we', k.id, 'FREQ=WEEKLY;BYDAY=WE', '17:00', 'HIGH'::"ScheduleConfidence",
       'STATIC_SCHEDULE'::"ScheduleRuleSource", 'https://www.facebook.com/tjbhhh',
       NOW() AT TIME ZONE 'UTC', true, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k WHERE k."kennelCode" = 'jb-h3'
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "isActive" = true, "sourceReference" = EXCLUDED."sourceReference", "startTime" = EXCLUDED."startTime",
  confidence = EXCLUDED.confidence, "lastValidatedAt" = EXCLUDED."lastValidatedAt", "updatedAt" = EXCLUDED."updatedAt";

UPDATE "Kennel"
SET "scheduleDayOfWeek" = 'Wednesday',
    "scheduleNotes" = 'Weekly Wednesday evening runs around Johor Bahru, just across the causeway from Singapore. Founded 1969 (the original JBHHH).',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'jb-h3'
  AND ("scheduleDayOfWeek" IS DISTINCT FROM 'Wednesday'
       OR "scheduleNotes" IS DISTINCT FROM 'Weekly Wednesday evening runs around Johor Bahru, just across the causeway from Singapore. Founded 1969 (the original JBHHH).');

-- ===== 4. Hebe H3: 1st Saturday -> 3rd Saturday =====
UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('rrule', 'FREQ=MONTHLY;BYDAY=3SA'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Hebe H3 Static Schedule' AND type = 'STATIC_SCHEDULE'::"SourceType"
  AND config->>'rrule' IS DISTINCT FROM 'FREQ=MONTHLY;BYDAY=3SA';

UPDATE "ScheduleRule" r
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE r."kennelId" = k.id AND k."kennelCode" = 'hebe-h3'
  AND r.rrule = 'FREQ=MONTHLY;BYDAY=1SA' AND r."isActive";

-- Same shape the seed's schedule-rule backfill produces for a kennel with
-- seeded scheduleRules (#1492 absorb): an active SEED_DATA row for the 3SA rule,
-- freshly validated. The old inactive STATIC_SCHEDULE 3SA row stays inactive.
INSERT INTO "ScheduleRule" (id, "kennelId", rrule, "startTime", confidence, source, "sourceReference", "lastValidatedAt", "isActive", "createdAt", "updatedAt", label, "displayOrder")
SELECT 'mig_drift_hebe_seed_3sa', k.id, 'FREQ=MONTHLY;BYDAY=3SA', '15:00', 'HIGH'::"ScheduleConfidence",
       'SEED_DATA'::"ScheduleRuleSource", 'KennelSeed.scheduleRules[hebe-h3]',
       NOW() AT TIME ZONE 'UTC', true, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC', 'Monthly', 0
FROM "Kennel" k WHERE k."kennelCode" = 'hebe-h3'
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "isActive" = true, label = EXCLUDED.label, "sourceReference" = EXCLUDED."sourceReference",
  "startTime" = EXCLUDED."startTime", confidence = EXCLUDED.confidence,
  "lastValidatedAt" = EXCLUDED."lastValidatedAt", "updatedAt" = EXCLUDED."updatedAt";

UPDATE "Kennel"
SET "scheduleNotes" = '3rd Saturday of the month at 3:00 PM in the Sai Kung area. Founded 2019.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hebe-h3'
  AND "scheduleNotes" IS DISTINCT FROM '3rd Saturday of the month at 3:00 PM in the Sai Kung area. Founded 2019.';

-- ===== 1, 3, 4. Delete the placeholder events =====
-- An event qualifies only when all its raws come from the one static source
-- being fixed (manual entries and mixed-provenance events are kept).
CREATE TEMPORARY TABLE drift_ghost_events ON COMMIT DROP AS
SELECT e.id, e."kennelId"
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
JOIN (VALUES
  ('gatr-h3', 'GATR H3 Static Schedule', NULL::int, false),
  ('jb-h3',   'JB H3 Static Schedule',   6,         false),
  ('hebe-h3', 'Hebe H3 Static Schedule', 6,         true)
) AS t(code, source_name, dow, first_week_only) ON t.code = k."kennelCode"
WHERE (t.dow IS NULL OR EXTRACT(DOW FROM e.date) = t.dow)
  AND (NOT t.first_week_only OR EXTRACT(DAY FROM e.date) <= 7)
  AND EXISTS (  -- NOSONAR plsql:S1138 — semi-join on provenance
    SELECT 1 FROM "RawEvent" re JOIN "Source" s ON s.id = re."sourceId"
    WHERE re."eventId" = e.id AND s.name = t.source_name AND s.type = 'STATIC_SCHEDULE'::"SourceType")
  AND NOT EXISTS (  -- NOSONAR plsql:S1138 — anti-join: any other source keeps the event
    SELECT 1 FROM "RawEvent" re2 JOIN "Source" s2 ON s2.id = re2."sourceId"
    WHERE re2."eventId" = e.id AND (s2.name <> t.source_name OR s2.type <> 'STATIC_SCHEDULE'::"SourceType"));

CREATE TEMPORARY TABLE drift_affected_kennels ON COMMIT DROP AS
SELECT DISTINCT "kennelId" FROM drift_ghost_events
UNION
SELECT DISTINCT ek."kennelId" FROM "EventKennel" ek WHERE ek."eventId" IN (SELECT id FROM drift_ghost_events);

UPDATE "RawEvent" SET "eventId" = NULL, processed = false WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
UPDATE "Event" SET "parentEventId" = NULL WHERE "parentEventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "EventKennel"      WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "EventLink"        WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "EventHare"        WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "Attendance"       WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "KennelAttendance" WHERE "eventId" IN (SELECT id FROM drift_ghost_events);
DELETE FROM "Event"            WHERE id        IN (SELECT id FROM drift_ghost_events);

-- Same predicate as src/pipeline/backfill-last-event.ts: canonical, not
-- cancelled, not manual, as primary kennel or as a co-host.
UPDATE "Kennel"
SET "lastEventDate" = (
  SELECT MAX(d) FROM (
    SELECT e.date AS d FROM "Event" e
    WHERE e."kennelId" = "Kennel".id AND e.status::text <> 'CANCELLED' AND NOT e."isManualEntry" AND e."isCanonical"
    UNION ALL
    SELECT e.date FROM "EventKennel" ek JOIN "Event" e ON e.id = ek."eventId"
    WHERE ek."kennelId" = "Kennel".id AND e.status::text <> 'CANCELLED' AND NOT e."isManualEntry" AND e."isCanonical"
  ) dates
)
WHERE id IN (SELECT "kennelId" FROM drift_affected_kennels);

-- ===== 5. Retire stale duplicates (never delete) =====
UPDATE "Source" old
SET enabled = false,
    "replacedById" = repl.id,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('MGH4 Static Schedule', 'MGH4 Static Schedule (Biweekly Saturday)'),
  ('Kowloon H3 Static Schedule', 'Kowloon H3 Hareline Sheet'),
  ('Rumson Weekly Runs (Static Recurring)', 'Rumson H3 Static Schedule')
) AS t(old_name, repl_name)
JOIN "Source" repl ON repl.name = t.repl_name
  AND repl.type = (CASE WHEN t.repl_name = 'Kowloon H3 Hareline Sheet' THEN 'GOOGLE_SHEETS' ELSE 'STATIC_SCHEDULE' END)::"SourceType"
WHERE old.name = t.old_name AND old.type = 'STATIC_SCHEDULE'::"SourceType"
  AND (old.enabled OR old."replacedById" IS DISTINCT FROM repl.id);

COMMIT;
