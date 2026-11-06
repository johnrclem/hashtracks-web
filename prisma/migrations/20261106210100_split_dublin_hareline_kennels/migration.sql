-- Split the Dublin H3 Website Hareline into its kennels (#2759, owner-approved
-- 2026-11-06).
--
-- Every row of dublinhhh.com/archive was filed under Dublin H3 (`dh3`). The
-- archive's Hash column (the site's own `hash` / `other_hash` field) says which
-- kennel a row belongs to; DublinHashAdapter.routeDublinRow now routes by it:
--   "I ♥ Monday #NNN"  → new kennel `i-love-monday` (even-week Mondays, own
--                        count #324 Dec 2022 → #429 Dec 2026; was an alias of dh3)
--   "Shed Hash #N"     → new kennel `shed-h3` (annual August trail in Naas)
--   Marathon water stations (volunteer duty) and Cork H3's trail in Cork are
--   dropped by the adapter, and their three events are deleted here.
--   Everything else stays on dh3, including the Wren Boys runs, Nash Hash
--   (2026-07-03), the 2023 Paddy's Day pick-up and the Shanghai reunion run
--   Dublin HHH hosted.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/{kennels,aliases,sources}.ts. Idempotent.
-- Expected on prod at authoring time: 106 → i-love-monday, 4 → shed-h3,
-- 3 deleted; dh3 keeps 109 (108 CONFIRMED + the cancelled Nash Hash row).

BEGIN;

-- 1. Kennels ---------------------------------------------------------------
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  "parentKennelCode", website, "logoUrl", "facebookUrl", "instagramHandle",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_i_love_monday', 'i-love-monday', 'I ♥ Monday', 'i-love-monday',
  'I Love Monday Hash House Harriers', r.name, r.id, 'IE',
  'dh3', 'https://dublinhhh.com/', 'https://dublinhhh.com/assets/images/leprechaun.gif',
  'https://www.facebook.com/groups/dublinhashhouseharriers/', 'dublinhashhouseharriers',
  'Monday', '19:30', 'Biweekly',
  'Dublin HHH''s other Monday series: every other Monday at 19:30, alternating with Dublin H3 and numbered on its own count. Trails start from a pub around Dublin and finish back there.',
  53.3498, -6.2603, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Dublin'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleFrequency", "scheduleNotes", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_shed_h3', 'shed-h3', 'Shed Hash', 'shed-hash', 'Shed Hash House Harriers',
  r.name, r.id, 'IE', 'https://dublinhhh.com/', 'Saturday', 'Annually',
  'One Saturday afternoon each August at The Shed, Naas, Co. Kildare: hydration from 14:00, trail around 14:30–15:00, BBQ after.',
  'An annual Saturday-afternoon trail at The Shed in Naas, Co. Kildare, every August: long and short trails with a beer stop, a circle at the finish, then a BBQ. Run by Dublin hashers on its own count and listed on the Dublin HHH hareline.',
  53.2226, -6.6521, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Dublin'
ON CONFLICT ("kennelCode") DO NOTHING;

-- Dublin H3 itself now runs every other Monday.
UPDATE "Kennel"
SET "scheduleFrequency" = 'Biweekly',
    description = 'Ireland''s longest-running hash, founded in 1986. Runs every other Monday at 19:30 from a pub in the Dublin area; the Mondays in between belong to its sister series, I ♥ Monday.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'dh3' AND "scheduleFrequency" IS DISTINCT FROM 'Biweekly';

-- 2. Aliases ---------------------------------------------------------------
DELETE FROM "KennelAlias" a
USING "Kennel" k
WHERE a."kennelId" = k.id AND k."kennelCode" = 'dh3' AND a.alias = 'I Love Monday';

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_ilm_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'I Love Monday'), (2, 'I ♥ Monday'), (3, 'I Heart Monday'),
             (4, 'I Love Monday H3'), (5, 'I Love Monday Hash'))
       AS t(n, alias)
WHERE k."kennelCode" = 'i-love-monday'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_shedh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Shed Hash'), (2, 'Shed H3'), (3, 'The Shed Hash')) AS t(n, alias)
WHERE k."kennelCode" = 'shed-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. Source links ----------------------------------------------------------
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_dublin_hareline_' || replace(k."kennelCode", '-', '_'), s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Dublin H3 Website Hareline' AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND k."kennelCode" IN ('i-love-monday', 'shed-h3')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 4. Schedule rules: two interleaved biweekly Monday series. Anchors are the
--    next run of each (Dublin H3 #1685 2026-11-09, I ♥ Monday #427 2026-11-16).
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "anchorDate", "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", "displayOrder", "createdAt", "updatedAt"
)
SELECT 'sr_' || replace(k."kennelCode", '-', '_') || '_biweekly_mo', k.id,
       'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', t.anchor, '19:30',
       'HIGH'::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource",
       'KennelSeed.scheduleRules[' || k."kennelCode" || ']',
       NOW() AT TIME ZONE 'UTC', true, 0, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
JOIN (VALUES ('dh3', '2026-11-09'), ('i-love-monday', '2026-11-16')) AS t(code, anchor)
  ON t.code = k."kennelCode"
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- The anchored rule supersedes dh3's unprojectable LOW cadence placeholder.
UPDATE "ScheduleRule" sr
SET "isActive" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE sr."kennelId" = k.id AND k."kennelCode" = 'dh3'
  AND sr.rrule = 'CADENCE=BIWEEKLY;BYDAY=MO' AND sr.source = 'SEED_DATA'::"ScheduleRuleSource"
  AND sr."isActive" = true;

-- 5. Re-home events by the archive label stored as the title ----------------
CREATE TEMP TABLE dublin_moves ON COMMIT DROP AS
SELECT e.id AS event_id, d.id AS from_id, t.id AS to_id, t."kennelCode" AS to_code
FROM "Event" e
JOIN "Kennel" d ON d.id = e."kennelId" AND d."kennelCode" = 'dh3'
JOIN "Kennel" t ON t."kennelCode" = CASE
    WHEN lower(regexp_replace(e.title, '\s', '', 'g')) LIKE 'i♥monday%' THEN 'i-love-monday'
    WHEN lower(regexp_replace(e.title, '\s', '', 'g')) LIKE 'shed%' THEN 'shed-h3'
  END
WHERE NOT EXISTS (
  SELECT 1 FROM "Event" x WHERE x."kennelId" = t.id AND x.date = e.date AND x.id <> e.id
);

UPDATE "EventKennel" ek
SET "kennelId" = m.to_id
FROM dublin_moves m
WHERE ek."eventId" = m.event_id AND ek."kennelId" = m.from_id
  AND NOT EXISTS (
    SELECT 1 FROM "EventKennel" x WHERE x."eventId" = m.event_id AND x."kennelId" = m.to_id
  );

UPDATE "Event" e
SET "kennelId" = m.to_id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM dublin_moves m
WHERE e.id = m.event_id AND e."kennelId" = m.from_id;

-- 6. Delete the three non-Dublin-H3 rows the adapter now drops. Guarded: only
--    these exact rows, and only when nothing user-facing hangs off them. Their
--    RawEvents are kept (eventId → NULL, processed) as the audit trail.
CREATE TEMP TABLE dublin_drops ON COMMIT DROP AS
SELECT e.id
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId" AND k."kennelCode" = 'dh3'
WHERE e."isManualEntry" IS NOT TRUE
  AND (   (e.date = TIMESTAMP '2023-03-17 12:00:00' AND e.title = 'Cork H3')
       OR (e.date = TIMESTAMP '2023-10-29 12:00:00' AND e.title = 'Other MARATHON WATER STATION')
       OR (e.date = TIMESTAMP '2025-10-26 12:00:00' AND e.title = 'Marathon Water Stop'))
  AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "EventHare" h WHERE h."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "Event" c WHERE c."parentEventId" = e.id)
  AND e."parentEventId" IS NULL;

UPDATE "RawEvent" r
SET "eventId" = NULL, processed = true
FROM dublin_drops x
WHERE r."eventId" = x.id;

DELETE FROM "Event" e USING dublin_drops x WHERE e.id = x.id;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT to_code, count(*) AS n FROM dublin_moves GROUP BY to_code ORDER BY to_code LOOP
    RAISE NOTICE 'dublin split: % event(s) → %', r.n, r.to_code;
  END LOOP;
  RAISE NOTICE 'dublin split: % non-trail / other-club event(s) deleted', (SELECT count(*) FROM dublin_drops);
END $$;

-- 7. Cached lastEventDate, mirroring the nightly backfillLastEventDates().
UPDATE "Kennel" k
SET "lastEventDate" = (
  SELECT MAX(e.date) FROM "Event" e
  WHERE (e."kennelId" = k.id
         OR EXISTS (SELECT 1 FROM "EventKennel" ek WHERE ek."eventId" = e.id AND ek."kennelId" = k.id))
    AND e.status::text <> 'CANCELLED'
    AND e."isManualEntry" IS NOT TRUE
    AND e."isCanonical" = true
)
WHERE k."kennelCode" IN ('dh3', 'i-love-monday', 'shed-h3');

COMMIT;
