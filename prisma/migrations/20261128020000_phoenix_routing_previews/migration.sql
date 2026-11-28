-- Phoenix H3 sources: new kennels, routing, calendar previews, Events Manager template (2026-11-28).
-- Refs #3103 #3104 #3136.
--
-- Data only; every statement is guarded by the value it replaces or ON CONFLICT, so a
-- re-run is a no-op. Seed changes reach prod only through a migration:
-- prisma/seed-data/{kennels,aliases,sources}.ts carry the same rows.
-- 1. Seven kennels from phoenixhhh.org's calendar: the Phoenix H3 umbrella (1988) and six
--    of its hashes (Full Moon, JHOT, Throw Down Thursday, PBR, Rising H3, Crankwankers
--    BASH), with aliases, schedule rules and links to both Phoenix sources. The four
--    existing Phoenix kennels get Phoenix H3 as their parent.
-- 2. Both sources route the new hashes, send everything else to Phoenix H3 instead of
--    Wrong Way, and read Hump D runs titled "Hump Hash …" / "One Last Hump …".
-- 3. The calendar's month pages show every event twice: a full entry and a compact grid
--    preview. The adapter read no title or link from the preview, so each one became an
--    untitled "Wrong Way Trail" on its event's date (141 rows, 107 already cancelled).
--    They are deleted with their raw rows; none has attendance, hares or child events.
-- 4. Runs of other Phoenix hashes filed under Wrong Way move to their kennel (Phoenix H3
--    for specials). Where copies of one run share a kennel, date and title (a raw-less
--    backfill copy, or one copy per source), or the kennel already has that day's run, the
--    raw rows move to one surviving event and the other copies go. A copy with attendance
--    or hares is never emptied or deleted: it is the survivor, and if it can't be (the
--    kennel already has that day's run, or a second such copy exists) the migration stops
--    so the attendance can be merged by hand. Neither case exists in the data today.
-- 5. Wrong Way #1168.5 is a half run: it loses the 1168 its real #1168 holds.
-- 6. Every Phoenix detail-page description started with the Events Manager template
--    ("Map Unavailable / Date/Time / Date(s) - … / Categories / No Categories"); it is
--    removed, and a description that was only the template becomes NULL.
-- Kennel.lastEventDate is recomputed by the daily audit cron (backfillLastEventDates).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1a. Kennels.
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country, website,
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "foundedYear", founder, "parentKennelCode", "hashCash", "walkersWelcome", description,
  latitude, longitude, "createdAt", "updatedAt"
)
SELECT t.id, t.code, t.short, t.slug, t.full_name, 'Phoenix, AZ', r.id, 'USA', t.website,
  t.dow, t.time, t.freq, t.notes, t.founded, t.founder, t.parent, t.cash, t.walkers, t.descr,
  33.45, -112.07, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r,
  (VALUES
    ('knl_ph3_phx', 'ph3-phx', 'Phoenix H3', 'phoenix-h3', 'Phoenix Hash House Harriers', 'https://www.phoenixhhh.org',
     NULL, NULL, NULL, NULL, 1988, 'Wrong Way and Lazarus Arnold', NULL, NULL, NULL::boolean,
     'The Phoenix Hash House Harriers, founded in October 1988 at North Mountain Park. It is the umbrella for the valley''s hashes (Wrong Way, Hump D, LBH, Full Moon, JHOT and others); its specials, such as the Red Dress Run, campouts and anniversary hashes, are listed here.'),
    ('knl_fmh3_phx', 'fmh3-phx', 'Phoenix Full Moon', 'phoenix-full-moon', 'Phoenix Full Moon Hash', 'https://www.phoenixhhh.org/?page_id=31',
     NULL, NULL, 'Full Moon', 'On the night of the full moon, usually from a park. Hares away about 7 PM Sunday–Thursday. 21+.',
     NULL, NULL, 'ph3-phx', '$8', NULL,
     'Phoenix''s full moon hash: a trail on the night of every full moon, usually starting at a park with hash beer before trail. $8 hash cash; first-time hashers are free.'),
    ('knl_jhot_phx', 'jhot-phx', 'JHOT', 'jhot', 'Just a Hash on Tuesday', 'https://www.phoenixhhh.org/?page_id=1240',
     'Tuesday', '6:30 PM', 'Biweekly', '2nd & 4th Tuesdays. A to A, 2–4 miles with one beer near. 21+.',
     2013, NULL, 'ph3-phx', '$2', true,
     'Phoenix''s Tuesday evening hash, started in September 2013: 2nd and 4th Tuesdays, an A-to-A trail of 2–4 miles with one beer near. $2 goes to the hares.'),
    ('knl_tdt_phx', 'tdt-phx', 'Throw Down Thursday', 'throw-down-thursday', 'Throw Down Thursday Hash', 'https://www.phoenixhhh.org/?page_id=1572',
     'Thursday', '6:30 PM', 'Biweekly', '2nd & 4th Thursdays, except when there is a full moon hash. 21+.',
     2013, 'Sidewalk Slap', 'ph3-phx', NULL, NULL,
     'Phoenix''s Thursday hash, started in 2013 by Sidewalk Slap: a non-stop trail with one hare, who carries the beer and flour, built to match the mileage of the Hump.'),
    ('knl_pbr_phx', 'pbr-phx', 'Phoenix PBR', 'phoenix-pbr', 'Phoenix PBR Hash', 'https://www.phoenixhhh.org',
     'Friday', '6:30 PM', 'Monthly', '2nd Friday of the month. Meet 6:30 PM, hares off 6:45, pack away 7:00.',
     NULL, NULL, 'ph3-phx', '$5', NULL,
     'Phoenix''s monthly Friday evening hash on the 2nd Friday, with Pabst Blue Ribbon as the beer. $5 hash cash, the same for virgins.'),
    ('knl_rising_phx', 'rising-phx', 'Rising H3', 'rising-h3', 'Rising Hash House Harriers', 'https://www.phoenixhhh.org',
     NULL, NULL, 'Irregular', 'Phoenix Rising FC home matches, often after a Wrong Way trail.',
     NULL, NULL, 'ph3-phx', NULL, NULL,
     'Phoenix hashers'' social at Phoenix Rising FC home matches: they take over the south end of the stadium, often after a Wrong Way trail.'),
    ('knl_bash_phx', 'bash-phx', 'Crankwankers BASH', 'crankwankers-bash', 'Phoenix Crank Wankers Bikes, Beer & Brunch Bike Hash', 'https://www.phoenixhhh.org/?page_id=131',
     NULL, NULL, 'Monthly', '2nd Sunday morning (Oct–May); 2nd Saturday evening (Jun–Sep). Bike hash of up to 15 miles. 21+.',
     NULL, NULL, 'ph3-phx', 'Free (BYOB)', NULL,
     'Phoenix''s monthly bike hash: Bikes, Beer & Brunch on a flat route of up to 15 miles, finishing at a local spot for brunch. 2nd Sunday morning in winter, 2nd Saturday evening in summer.')
  ) AS t(id, code, short, slug, full_name, website, dow, time, freq, notes, founded, founder, parent, cash, walkers, descr)
WHERE r.name = 'Phoenix, AZ'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 1b. Aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_' || replace(t.code, '-', '_') || '_' || t.n, k.id, t.alias
FROM "Kennel" k JOIN (VALUES
    ('ph3-phx', 1, 'Phoenix Hash'), ('ph3-phx', 2, 'Phoenix HHH'), ('ph3-phx', 3, 'Phoenix Hash House Harriers'),
    ('fmh3-phx', 1, 'Phoenix Full Moon Hash'), ('fmh3-phx', 2, 'Phoenix Full Moon H3'), ('fmh3-phx', 3, 'Phoenix FMH3'),
    ('jhot-phx', 1, 'Just a Hash on Tuesday'), ('jhot-phx', 2, 'JHOT H3'), ('jhot-phx', 3, 'JHoT'),
    ('tdt-phx', 1, 'Throwdown Thursday'), ('tdt-phx', 2, 'Thursday Throwdown'), ('tdt-phx', 3, 'Throw Down Thursday H3'),
    ('pbr-phx', 1, 'Phoenix PBR Hash'), ('pbr-phx', 2, 'PBR Hash'), ('pbr-phx', 3, 'PBR H3'),
    ('rising-phx', 1, 'Rising Hash'), ('rising-phx', 2, 'Phoenix Rising H3'),
    ('bash-phx', 1, 'Crank Wankers BASH'), ('bash-phx', 2, 'Crankwankers Bike Hash'), ('bash-phx', 3, 'Phoenix BASH')
  ) AS t(code, n, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 1c. Schedule rules (seed scheduleRules; Full Moon's FREQ=LUNAR is what the seed
--     backfill derives from scheduleFrequency "Full Moon").
INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source, "sourceReference",
  "lastValidatedAt", "isActive", label, "validFrom", "validUntil", "displayOrder", notes,
  "createdAt", "updatedAt"
)
SELECT t.id, k.id, t.rrule, t.start_time, t.conf::"ScheduleConfidence", 'SEED_DATA'::"ScheduleRuleSource",
  t.ref, NOW() AT TIME ZONE 'UTC', true, t.label, t.valid_from, t.valid_until, t.ord, t.notes,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k JOIN (VALUES
    ('sr_fmh3_phx_1', 'fmh3-phx', 'FREQ=LUNAR', NULL, 'LOW', 'Kennel.scheduleDayOfWeek/Frequency', NULL, NULL, NULL, 0, 'Full moon schedule'),
    ('sr_jhot_phx_1', 'jhot-phx', 'FREQ=MONTHLY;BYDAY=2TU', '18:30', 'LOW', 'KennelSeed.scheduleRules[jhot-phx]', NULL, NULL, NULL, 0, NULL),
    ('sr_jhot_phx_2', 'jhot-phx', 'FREQ=MONTHLY;BYDAY=4TU', '18:30', 'LOW', 'KennelSeed.scheduleRules[jhot-phx]', NULL, NULL, NULL, 1, NULL),
    ('sr_tdt_phx_1', 'tdt-phx', 'FREQ=MONTHLY;BYDAY=2TH', '18:30', 'LOW', 'KennelSeed.scheduleRules[tdt-phx]', NULL, NULL, NULL, 0, NULL),
    ('sr_tdt_phx_2', 'tdt-phx', 'FREQ=MONTHLY;BYDAY=4TH', '18:30', 'LOW', 'KennelSeed.scheduleRules[tdt-phx]', NULL, NULL, NULL, 1, NULL),
    ('sr_pbr_phx_1', 'pbr-phx', 'FREQ=MONTHLY;BYDAY=2FR', '18:30', 'MEDIUM', 'KennelSeed.scheduleRules[pbr-phx]', NULL, NULL, NULL, 0, NULL),
    ('sr_bash_phx_1', 'bash-phx', 'FREQ=MONTHLY;BYDAY=2SA;BYMONTH=6,7,8,9', '17:00', 'MEDIUM', 'KennelSeed.scheduleRules[bash-phx]', 'Summer (Jun–Sep)', '06-01', '09-30', 0, NULL),
    ('sr_bash_phx_2', 'bash-phx', 'FREQ=MONTHLY;BYDAY=2SU;BYMONTH=1,2,3,4,5,10,11,12', '10:00', 'MEDIUM', 'KennelSeed.scheduleRules[bash-phx]', 'Oct–May', '10-01', '05-31', 1, NULL)
  ) AS t(id, code, rrule, start_time, conf, ref, label, valid_from, valid_until, ord, notes) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", rrule, source) DO NOTHING;

-- 1d. Phoenix H3 is the parent of the four existing Phoenix kennels.
UPDATE "Kennel"
SET "parentKennelCode" = 'ph3-phx', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" IN ('lbh-phx', 'hump-d', 'wrong-way', 'fdtdd') AND "parentKennelCode" IS NULL;

-- 1e. Links to both Phoenix sources (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_' || replace(k."kennelCode", '-', '_') || CASE s.type WHEN 'ICAL_FEED'::"SourceType" THEN '_phx_ical' ELSE '_phx_cal' END, s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name IN ('Phoenix H3 Events', 'Phoenix H3 Big Ass Calendar')
  AND k."kennelCode" IN ('ph3-phx', 'fmh3-phx', 'jhot-phx', 'tdt-phx', 'pbr-phx', 'rising-phx', 'bash-phx')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 2. Source configs.
UPDATE "Source"
SET config = jsonb_set(config, '{kennelPatterns}', '[["^LBH\\b|Lost Boobs","lbh-phx"],["Wrong Way","wrong-way"],["Hump D|\\bHump\\b","hump-d"],["Dusk.*Down|FDTDD|Friday the 13th","fdtdd"],["\\bFull\\b.*\\bMoon\\b","fmh3-phx"],["\\bJHOT\\b","jhot-phx"],["Throw ?down","tdt-phx"],["\\bPBR\\b","pbr-phx"],["\\bRising H3\\b","rising-phx"],["(?:January|February|March|April|May|June|July|August|September|October|November|December)\\b[^#]*\\bBash\\b|Free Beer Bash|Crank ?wank","bash-phx"]]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name IN ('Phoenix H3 Events', 'Phoenix H3 Big Ass Calendar')
  AND config->'kennelPatterns' = '[["^LBH\\b|Lost Boobs","lbh-phx"],["Hump D","hump-d"],["Wrong Way","wrong-way"],["Dusk.*Down|FDTDD","fdtdd"]]'::jsonb;

UPDATE "Source"
SET config = config || '{"defaultKennelTag":"ph3-phx"}'::jsonb, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name IN ('Phoenix H3 Events', 'Phoenix H3 Big Ass Calendar')
  AND config->>'defaultKennelTag' = 'wrong-way';

UPDATE "Source"
SET config = config || '{"kennelHashCash":{"hump-d":"$1","lbh-phx":"$5","fmh3-phx":"$8","jhot-phx":"$2","pbr-phx":"$5"}}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Phoenix H3 Big Ass Calendar'
  AND config->'kennelHashCash' = '{"hump-d":"$1","lbh-phx":"$5"}'::jsonb;

-- 3. Untitled preview rows. Merge linked some into multi-day series: a real run whose only
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

-- 4. Other hashes' runs under Wrong Way. A run is Wrong Way's when its title says
--    "Wrong Way #" or a raw row's title names Wrong Way; the rest are classified by the
--    same rules as the sources' kennelPatterns, in the same order. An event whose title
--    was replaced by the default "Wrong Way Trail" is classified by its latest raw title.
CREATE TEMP TABLE phoenix_move ON COMMIT DROP AS
SELECT b.id, b.date, b.status, b.raws, b.default_title, b.protected,
  lower(regexp_replace(b.t, '[–—]', '-', 'g')) AS norm,
  CASE
    WHEN b.t ~* '^LBH\M|lost boobs' THEN 'lbh-phx'
    WHEN b.t ~* 'hump d|\mhump\M' THEN 'hump-d'
    WHEN b.t ~* 'dusk.*down|fdtdd|friday the 13th' THEN 'fdtdd'
    WHEN b.t ~* '\mfull\M.*\mmoon\M' THEN 'fmh3-phx'
    WHEN b.t ~* '\mjhot\M' THEN 'jhot-phx'
    WHEN b.t ~* 'throw ?down' THEN 'tdt-phx'
    WHEN b.t ~* '\mpbr\M' THEN 'pbr-phx'
    WHEN b.t ~* '\mrising h3\M' THEN 'rising-phx'
    WHEN b.t ~* '(january|february|march|april|may|june|july|august|september|october|november|december)\M[^#]*\mbash\M|free beer bash|crank ?wank' THEN 'bash-phx'
    ELSE 'ph3-phx'
  END AS target
FROM (
  SELECT e.id, e.date, e.status, e.title = 'Wrong Way Trail' AS default_title,
    (SELECT count(*) FROM "RawEvent" r WHERE r."eventId" = e.id) AS raws,
    EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)
      OR EXISTS (SELECT 1 FROM "KennelAttendance" a WHERE a."eventId" = e.id)
      OR EXISTS (SELECT 1 FROM "EventHare" h WHERE h."eventId" = e.id) AS protected,
    CASE WHEN e.title = 'Wrong Way Trail'
      THEN (SELECT r."rawData"->>'title' FROM "RawEvent" r
            WHERE r."eventId" = e.id AND r."rawData"->>'title' IS NOT NULL ORDER BY r."scrapedAt" DESC LIMIT 1)
      ELSE e.title END AS t
  FROM "Event" e JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" = 'wrong-way'
    AND e.title !~* 'wrong.?way\s*#'
    AND NOT EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = e.id AND r."rawData"->>'title' ~* 'wrong.?way')
) b
WHERE b.t IS NOT NULL;

-- One surviving event per run: an event the target kennel already has that day, else the
-- copy with attendance or hares, then the confirmed copy with the most raw rows.
CREATE TEMP TABLE phoenix_keep ON COMMIT DROP AS
SELECT DISTINCT ON (m.target, m.date, m.norm) m.target, m.date, m.norm, COALESCE(d.id, m.id) AS keeper
FROM phoenix_move m
LEFT JOIN LATERAL (
  SELECT o.id FROM "Event" o JOIN "Kennel" t ON t.id = o."kennelId"
  WHERE t."kennelCode" = m.target AND o.date = m.date
  ORDER BY (o.status = 'CONFIRMED') DESC, o.id
  LIMIT 1
) d ON true
ORDER BY m.target, m.date, m.norm, m.protected DESC, (m.status = 'CONFIRMED') DESC, m.raws DESC, m.id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM phoenix_move m JOIN phoenix_keep kp ON (kp.target, kp.date, kp.norm) = (m.target, m.date, m.norm)
    WHERE m.protected AND m.id <> kp.keeper
  ) THEN
    RAISE EXCEPTION 'A Wrong Way run with attendance or hares duplicates another copy of the run; merge it by hand';
  END IF;
END $$;

UPDATE "RawEvent" r
SET "eventId" = kp.keeper
FROM phoenix_move m JOIN phoenix_keep kp ON (kp.target, kp.date, kp.norm) = (m.target, m.date, m.norm)
WHERE r."eventId" = m.id AND m.id <> kp.keeper;

DELETE FROM "Event" e
USING phoenix_move m JOIN phoenix_keep kp ON (kp.target, kp.date, kp.norm) = (m.target, m.date, m.norm)
WHERE e.id = m.id AND m.id <> kp.keeper;

-- The survivors that are Wrong Way events move.
UPDATE "Event" e
SET "kennelId" = t.id,
    title = CASE WHEN m.default_title THEN t."shortName" || ' Trail' ELSE e.title END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM phoenix_move m
JOIN phoenix_keep kp ON (kp.target, kp.date, kp.norm) = (m.target, m.date, m.norm)
JOIN "Kennel" t ON t."kennelCode" = m.target
WHERE e.id = m.id AND m.id = kp.keeper;

UPDATE "EventKennel" ek
SET "kennelId" = e."kennelId"
FROM "Event" e, "Kennel" ww, phoenix_move m
WHERE e.id = m.id AND ek."eventId" = e.id
  AND ww."kennelCode" = 'wrong-way' AND ek."kennelId" = ww.id AND e."kennelId" <> ww.id
  AND NOT EXISTS (SELECT 1 FROM "EventKennel" x WHERE x."eventId" = e.id AND x."kennelId" = e."kennelId");

-- 5. Wrong Way #1168.5 (half run) gave up 1168 to the real #1168.
UPDATE "Event" e
SET "runNumber" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'wrong-way'
  AND e."runNumber" = 1168 AND e.title LIKE 'Wrong Way #1168.5:%';

-- 6. Events Manager template at the top of Phoenix descriptions.
WITH stripped AS (
  SELECT e.id, e.description AS old,
    NULLIF(regexp_replace(e.description, '^(Map Unavailable\s+)?Date/Time\s+Date\(s\) - [^\n]*\n[^\n]*\n\s*(Location\s+[^\n]+\s+)?Categories\n[^\n]*\s*', ''), '') AS new
  FROM "Event" e JOIN "Kennel" k ON k.id = e."kennelId"
  WHERE k."kennelCode" IN ('lbh-phx', 'hump-d', 'fdtdd', 'wrong-way', 'ph3-phx', 'fmh3-phx', 'jhot-phx', 'tdt-phx', 'pbr-phx', 'rising-phx', 'bash-phx')
    AND e.description IS NOT NULL
)
UPDATE "Event" e
SET description = s.new, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM stripped s
WHERE e.id = s.id AND s.new IS DISTINCT FROM s.old;

COMMIT;
