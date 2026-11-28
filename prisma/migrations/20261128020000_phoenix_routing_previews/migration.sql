-- Phoenix H3 sources: routing, calendar previews, Events Manager template (2026-11-28).
-- Refs #3103 #3104 #3136.
--
-- Every statement is guarded by the value it replaces, so a re-run is a no-op.
-- 1. Both Phoenix sources skip hashes that aren't kennels here (strictKennelRouting) and
--    read Hump D runs titled "Hump Hash …" / "One Last Hump …"; Wrong Way's pattern now
--    comes before Hump's. Seed changes reach prod only through a migration.
-- 2. The calendar's month pages show every event twice: a full entry and a compact grid
--    preview. The adapter read no title or link from the preview, so each one became an
--    untitled "Wrong Way Trail" on its event's date (141 rows, 107 already cancelled).
--    They are deleted with their raw rows; none has attendance, hares or child events.
-- 3. Two Hump D runs filed under Wrong Way move to Hump D (no Hump D run on those dates).
-- 4. Every Phoenix detail-page description started with the Events Manager template
--    ("Map Unavailable / Date/Time / Date(s) - … / Categories / No Categories"); it is
--    removed, and a description that was only the template becomes NULL.
-- Kennel.lastEventDate is recomputed by the daily audit cron (backfillLastEventDates).
--
-- Left alone on purpose: 88 runs of Phoenix hashes HashTracks has no kennel for (Full Moon,
-- PBR, JHOT, Rising, Thursday Throwdown, …) stay under Wrong Way until those kennels are added.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Source configs.
UPDATE "Source"
SET config = config || '{"strictKennelRouting":true}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name IN ('Phoenix H3 Events', 'Phoenix H3 Big Ass Calendar')
  AND config->'strictKennelRouting' IS NULL;

UPDATE "Source"
SET config = jsonb_set(config, '{kennelPatterns}', '[["^LBH\\b|Lost Boobs","lbh-phx"],["Wrong Way","wrong-way"],["Hump D|\\bHump\\b","hump-d"],["Dusk.*Down|FDTDD","fdtdd"]]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name IN ('Phoenix H3 Events', 'Phoenix H3 Big Ass Calendar')
  AND config->'kennelPatterns' = '[["^LBH\\b|Lost Boobs","lbh-phx"],["Hump D","hump-d"],["Wrong Way","wrong-way"],["Dusk.*Down|FDTDD","fdtdd"]]'::jsonb;

-- 2. Untitled preview rows. Merge linked some into multi-day series: a real run whose only
--    children are previews stops being a series parent, and a kept run whose parent is a
--    preview is unlinked by the parentEventId foreign key (ON DELETE SET NULL). Raw rows
--    go first, then the events (EventKennel and EventLink cascade).
CREATE TEMP TABLE phoenix_preview ON COMMIT DROP AS
SELECT e.id FROM "Event" e JOIN "Kennel" k ON k.id = e."kennelId"
WHERE k."kennelCode" = 'wrong-way' AND e.title = 'Wrong Way Trail'
  AND NOT EXISTS (SELECT 1 FROM "RawEvent" t WHERE t."eventId" = e.id AND t."rawData"->>'title' IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" a WHERE a."eventId" = e.id)
  AND NOT EXISTS (SELECT 1 FROM "EventHare" h WHERE h."eventId" = e.id);

UPDATE "Event" p
SET "isSeriesParent" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE p."isSeriesParent" AND p.id NOT IN (SELECT id FROM phoenix_preview)
  AND EXISTS (SELECT 1 FROM "Event" c WHERE c."parentEventId" = p.id AND c.id IN (SELECT id FROM phoenix_preview))
  AND NOT EXISTS (SELECT 1 FROM "Event" c WHERE c."parentEventId" = p.id AND c.id NOT IN (SELECT id FROM phoenix_preview));

DELETE FROM "RawEvent" WHERE "eventId" IN (SELECT id FROM phoenix_preview);

DELETE FROM "Event" WHERE id IN (SELECT id FROM phoenix_preview);

-- 3. Hump D runs under Wrong Way: the event, then its primary EventKennel row.
UPDATE "Event" e
SET "kennelId" = hd.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" ww, "Kennel" hd
WHERE ww."kennelCode" = 'wrong-way' AND hd."kennelCode" = 'hump-d' AND e."kennelId" = ww.id
  AND (e.id, e.title) IN (
    ('cmn2ojr4z003204l50k86w4c3', 'Hump Hash – Saltfire'),
    ('cmn2ojyw4006804l5vssenuu5', 'One Last Hump for ’25: Cornish Tempe')
  )
  AND NOT EXISTS (SELECT 1 FROM "Event" o WHERE o."kennelId" = hd.id AND o.date = e.date);

UPDATE "EventKennel" ek
SET "kennelId" = e."kennelId"
FROM "Event" e, "Kennel" ww
WHERE e.id = ek."eventId" AND ww."kennelCode" = 'wrong-way' AND ek."kennelId" = ww.id
  AND e.id IN ('cmn2ojr4z003204l50k86w4c3', 'cmn2ojyw4006804l5vssenuu5')
  AND e."kennelId" <> ww.id
  AND NOT EXISTS (SELECT 1 FROM "EventKennel" x WHERE x."eventId" = e.id AND x."kennelId" = e."kennelId");

-- 4. Events Manager template at the top of Phoenix descriptions.
WITH stripped AS (
  SELECT e.id, e.description AS old,
    NULLIF(regexp_replace(e.description, '^(Map Unavailable\s+)?Date/Time\s+Date\(s\) - [^\n]*\n[^\n]*\n\s*(Location\s+[^\n]+\s+)?Categories\n[^\n]*\s*', ''), '') AS new
  FROM "Event" e JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" IN ('lbh-phx', 'hump-d', 'fdtdd', 'wrong-way') AND e.description IS NOT NULL
)
UPDATE "Event" e
SET description = s.new, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM stripped s
WHERE e.id = s.id AND s.new IS DISTINCT FROM s.old;

COMMIT;
