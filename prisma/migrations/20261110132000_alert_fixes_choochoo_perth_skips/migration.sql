-- Alert fixes (2026-11-10): non-run rows in two iCal feeds.
--   * Choo-Choo H3 iCal Feed has config NULL, so the iCal adapter tagged every row "UNKNOWN"
--     and the feed has created no event since it replaced the HTML scraper in April (every
--     ScrapeLog: 0 created, unmatchedTags {UNKNOWN}). It now gets defaultKennelTag. The
--     calendar also carries a year of "Monthly Drinking Practice" socials (4th Tuesday,
--     18:00); they aren't trails, and the Music City backfill dropped them too.
--   * Perth H3 Hareline posts holiday gaps as Monday rows titled "NO RUN TODAY- see you
--     on 24th ...". (Its 8 no-location rows, Runs 2957-2964, are real runs and stay.)
--
-- 1. Merge each source's new keys into its existing config (other keys untouched).
-- 2. Delete the phantom Events already ingested (prod: 6 Choo-Choo Drinking Practices,
--    Apr-Sep 2026, from the retired HTML scraper). Events with check-ins, hares or
--    series children are left alone.
--
-- DATA-ONLY, idempotent. Mirrors prisma/seed-data/sources.ts.

BEGIN;

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || t.patch,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('Choo-Choo H3 iCal Feed', '{"defaultKennelTag": "choochooh3",
     "silentlySkipPatterns": [{"pattern": "\\bdrinking practice\\b", "field": "title"}]}'::jsonb),
  ('Perth H3 Hareline', '{"silentlySkipPatterns": [{"pattern": "^NO RUN TODAY\\b", "field": "title"}]}'::jsonb)
) AS t(name, patch)
WHERE "Source".name = t.name AND "Source".type = 'ICAL_FEED'::"SourceType"
  AND NOT (COALESCE("Source".config, '{}'::jsonb) @> t.patch);

CREATE TEMP TABLE alert_fix_phantoms ON COMMIT DROP AS
SELECT e.id
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
WHERE ((k."kennelCode" = 'choochooh3' AND e.title ~* '\mdrinking practice\M')
    OR (k."kennelCode" = 'perth-h3'   AND e.title ~* '^NO RUN TODAY\M'))
  AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "EventHare" h WHERE h."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "Event" c WHERE c."parentEventId" = e.id);

DELETE FROM "RawEvent" WHERE "eventId" IN (SELECT id FROM alert_fix_phantoms);
-- EventKennel and EventLink cascade on Event delete.
DELETE FROM "Event" WHERE id IN (SELECT id FROM alert_fix_phantoms);

COMMIT;
