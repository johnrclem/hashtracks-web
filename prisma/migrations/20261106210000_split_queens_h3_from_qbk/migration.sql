-- Split Queens H3 off `qbk` (#2650, owner-approved 2026-11-06).
--
-- `qbk` held two independent run-number series that have run in parallel since
-- 2013: "Queens #NNN" (Queens H3, 1996–, #169–#249 in prod) and "Queens Black
-- Knights #NN" / "QBK #NN" (#1–#74). hashnyc.com lists them as two kennels
-- (/kennels/queens = Queens Black Knights H3, /kennels/queens-h3 = Queens H3).
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/{kennels,aliases,sources}.ts + the NYC Metro roster group in
-- prisma/seed.ts. Idempotent: a re-run finds nothing left to move.
--
-- Steps:
--   1. Create kennel `queens-h3`; `qbk` becomes shortName "QBK" (slug stays
--      "queens", matching hashnyc.com) with a QBK-only profile.
--   2. Move the bare "Queens" / "Queens Hash" aliases from qbk to queens-h3.
--   3. HashNYC iCal source: route `^Queens\b` to queens-h3 and link the kennel.
--   4. Add queens-h3 to the NYC Metro roster group (Queens #248's misman
--      attendance lives in that group's roster).
--   5. Re-home misfiled qbk events by the run designation in their title, the
--      same designation-first rule the HashNYC adapters use:
--        "… - Queens #NNN" (#169–#248) + the iCal-titled #249  → queens-h3
--        "Queens Hash Lives! - GGFM #253"   (2011-06-17)       → ggfm
--        "Queens. It's alive! - NYC #1477"  (2012-04-22)       → nych3
--        "Queens Lives! - Special #174"     (2020-07-26)       → nych3
--      GGFM #253 and NYC #1477 fill the exact gaps in those kennels' own run
--      sequences (GGFM #252 May / #254 Jul 2011; NYC #1476 Apr 15 / #1478 Apr 29
--      2012). "Special #N" is hashnyc's section label, filed under nych3 for
--      every other Special run (195 in prod). A move is skipped when the
--      target kennel already has an event that day.
--      Queens #247 (2024-08-03) was a joint run with QBK's 69th, so qbk stays
--      on it as a co-host (EventKennel, isPrimary = false).
--   6. lastEventDate for every kennel touched is recomputed by the next
--      migration in this deploy (20261106210100).
-- Expected on prod at authoring time: 80 → queens-h3, 1 → ggfm, 2 → nych3;
-- qbk keeps 74 (QBK #1–#74).

BEGIN;

-- 1. Kennels ---------------------------------------------------------------
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleNotes", "foundedYear", "logoUrl", description, latitude, longitude,
  "createdAt", "updatedAt"
)
SELECT
  'knl_queens_h3', 'queens-h3', 'Queens H3', 'queens-h3', 'Queens Hash House Harriers',
  r.name, r.id, 'USA', 'https://hashnyc.com', 'Sporadic.', 1996,
  '/kennel-logos/hashnyc-umbrella.png',
  'Queens Hash House Harriers — the original Queens kennel of the HashNYC family, founded in 1996. Ran every other Monday in the early 2000s; now sporadic, with occasional revival trails starting near public transit in Queens.',
  40.7509, -73.9411,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'New York City, NY'
ON CONFLICT ("kennelCode") DO NOTHING;

UPDATE "Kennel"
SET "shortName" = 'QBK',
    "foundedYear" = 2013,
    "scheduleNotes" = 'Sporadic, plus the annual Queen''s Birthday run on the second Saturday in June.',
    description = 'Queens Black Knights Hash House Harriers — a sporadic Queens kennel in the HashNYC family, founded in April 2013 (the name is a Monty Python joke). Starts near public transit in Queens; best known for the annual Queen''s Birthday run on the second Saturday in June.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'qbk' AND "shortName" <> 'QBK';

-- 2. Aliases ---------------------------------------------------------------
DELETE FROM "KennelAlias" a
USING "Kennel" k
WHERE a."kennelId" = k.id AND k."kennelCode" = 'qbk'
  AND a.alias IN ('Queens', 'Queens Hash');

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_queensh3_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Queens'), (2, 'Queens Hash'), (3, 'Queens H3'), (4, 'Queens HHH'),
             (5, 'Queens Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'queens-h3'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_qbk_split_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Queens Black Knights H3'), (2, 'Queens Black Knights Hash House Harriers'))
       AS t(n, alias)
WHERE k."kennelCode" = 'qbk'
ON CONFLICT ("kennelId", alias) DO NOTHING;

-- 3. HashNYC iCal routing + link -------------------------------------------
-- Swap only the generic Queens tuple, preserving order and every other entry.
-- '\\b' in this JSON literal stores as the two characters \b (regex word
-- boundary), exactly as the cutover migration stored it.
UPDATE "Source" s
SET config = jsonb_set(
      s.config, '{kennelPatterns}',
      (SELECT jsonb_agg(
                CASE WHEN t.elem = '["^Queens\\b", "qbk"]'::jsonb
                     THEN '["^Queens\\b", "queens-h3"]'::jsonb
                     ELSE t.elem END
                ORDER BY t.ord)
         FROM jsonb_array_elements(s.config -> 'kennelPatterns') WITH ORDINALITY AS t(elem, ord))),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE s.name = 'HashNYC Website' AND s.type = 'ICAL_FEED'::"SourceType"
  AND s.config -> 'kennelPatterns' @> '[["^Queens\\b", "qbk"]]'::jsonb;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hashnyc_ical_queens_h3', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'HashNYC Website' AND s.type = 'ICAL_FEED'::"SourceType"
  AND k."kennelCode" = 'queens-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 4. Roster group ----------------------------------------------------------
INSERT INTO "RosterGroupKennel" (id, "groupId", "kennelId")
SELECT 'rgk_nyc_metro_queens_h3', g.id, k.id
FROM "RosterGroup" g, "Kennel" k
WHERE g.name = 'NYC Metro' AND k."kennelCode" = 'queens-h3'
ON CONFLICT ("kennelId") DO NOTHING;

-- 5. Re-home misfiled qbk events --------------------------------------------
CREATE TEMP TABLE queens_moves ON COMMIT DROP AS
SELECT e.id AS event_id, e.date, src.id AS from_id, tgt.id AS to_id, tgt."kennelCode" AS to_code
FROM "Event" e
JOIN "Kennel" src ON src.id = e."kennelId" AND src."kennelCode" = 'qbk'
CROSS JOIN LATERAL (
  SELECT substring(e.title FROM ' - (Queens|GGFM|NYC|Special) #[0-9]+$') AS designation
) d
JOIN "Kennel" tgt ON tgt."kennelCode" = CASE
    WHEN d.designation = 'Queens' AND e."runNumber" >= 169 THEN 'queens-h3'
    WHEN d.designation = 'GGFM' THEN 'ggfm'
    WHEN d.designation IN ('NYC', 'Special') THEN 'nych3'
    -- iCal titles drop the designation ("7-11 C*ms to Queens!"); only Queens
    -- H3 numbers reach #169+, QBK is still in the #70s.
    WHEN d.designation IS NULL AND e."runNumber" BETWEEN 169 AND 999
         AND e.title !~* '(black knights|qbk)' THEN 'queens-h3'
  END
WHERE NOT EXISTS (
  SELECT 1 FROM "Event" x
  WHERE x."kennelId" = tgt.id AND x.date = e.date AND x.id <> e.id
);

UPDATE "EventKennel" ek
SET "kennelId" = m.to_id
FROM queens_moves m
WHERE ek."eventId" = m.event_id AND ek."kennelId" = m.from_id
  AND NOT EXISTS (
    SELECT 1 FROM "EventKennel" x WHERE x."eventId" = m.event_id AND x."kennelId" = m.to_id
  );

UPDATE "Event" e
SET "kennelId" = m.to_id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM queens_moves m
WHERE e.id = m.event_id AND e."kennelId" = m.from_id;

-- Queens #247 + QBK's 69th: keep qbk as co-host.
INSERT INTO "EventKennel" ("eventId", "kennelId", "isPrimary")
SELECT e.id, q.id, false
FROM "Event" e
JOIN "Kennel" qh ON qh.id = e."kennelId" AND qh."kennelCode" = 'queens-h3'
JOIN "Kennel" q ON q."kennelCode" = 'qbk'
WHERE e.date = TIMESTAMP '2024-08-03 12:00:00' AND e."runNumber" = 247
ON CONFLICT ("eventId", "kennelId") DO NOTHING;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT to_code, count(*) AS n FROM queens_moves GROUP BY to_code ORDER BY to_code LOOP
    RAISE NOTICE 'queens split: % event(s) → %', r.n, r.to_code;
  END LOOP;
END $$;

-- 6. Cached lastEventDate for qbk / queens-h3 / ggfm / nych3 is recomputed at
--    the end of 20261106210100_split_dublin_hareline_kennels (same deploy).

COMMIT;
