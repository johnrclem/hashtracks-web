-- Alert fixes (2026-11-10): non-run rows in two iCal feeds.
--   * Choo-Choo H3 iCal Feed now carries a year of "Monthly Drinking Practice" socials
--     (4th Tuesday, 18:00). They aren't trails; the Music City backfill dropped them too.
--   * Perth H3 Hareline posts holiday gaps as Monday rows titled "NO RUN TODAY- see you
--     on 24th ...". (Its 8 no-location rows, Runs 2957-2964, are real runs and stay.)
--
-- 1. Add a silentlySkipPatterns rule to each source (merged into the existing config).
-- 2. Delete the phantom Events already ingested. Skipped rows never reach reconcile, so
--    ~13 future Drinking Practice events would otherwise be orphaned at once and trip
--    the mass-cancel breaker. Events with check-ins or hares are left alone.
--
-- DATA-ONLY, idempotent. Mirrors prisma/seed-data/sources.ts.

BEGIN;

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('silentlySkipPatterns', t.rules),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('Choo-Choo H3 iCal Feed', '[{"pattern": "\\bdrinking practice\\b", "field": "title"}]'::jsonb),
  ('Perth H3 Hareline',      '[{"pattern": "^NO RUN TODAY\\b", "field": "title"}]'::jsonb)
) AS t(name, rules)
WHERE "Source".name = t.name AND "Source".type = 'ICAL_FEED'::"SourceType"
  AND "Source".config -> 'silentlySkipPatterns' IS DISTINCT FROM t.rules;

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
