-- #644: onboard Fool Moon H3 as its own kennel, routed off the shared Aloha H3 Google
-- Calendar (its full-moon trails carry their own run numbering, e.g. "Fool Moon H3 #409",
-- and previously landed under ah3-hi, the calendar's default kennel).
--
-- DATA-ONLY. Vercel never runs `db seed`, so the kennel row, SourceKennel link, the Aloha
-- kennelPattern, and the re-route of existing mis-attributed events are applied here.
-- Idempotent (ON CONFLICT / containment + kennelId guards); safe to re-apply.

BEGIN;

-- 1. Create the kennel (region resolved by name so no hard-coded regionId).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  "scheduleFrequency", "scheduleNotes", description, latitude, longitude, "createdAt", "updatedAt"
)
SELECT
  'knl_644_fool_moon_h3', 'fool-moon-h3', 'Fool Moon H3', 'fool-moon-h3',
  'Fool Moon Hash House Harriers', 'Honolulu, HI', r.id, 'USA',
  'Full Moon',
  'Monthly full-moon trail on Oahu. Run details posted on the Aloha H3 community calendar.',
  'Oahu''s full-moon hash — monthly trails timed to the full moon, with its own run numbering. Events appear on the shared Aloha H3 calendar.',
  21.31, -157.86, NOW(), NOW()
FROM "Region" r
WHERE r.name = 'Honolulu, HI'
ON CONFLICT ("kennelCode") DO NOTHING;

-- 2. Link the kennel to the Aloha H3 Google Calendar source (merge pipeline source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_644_aloha_fool_moon', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Aloha H3 Google Calendar' AND s.type::text = 'GOOGLE_CALENDAR'
  AND k."kennelCode" = 'fool-moon-h3'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 3. Add the "Fool Moon" kennelPattern to the Aloha source config (append if absent).
UPDATE "Source"
SET config = jsonb_set(
      config,
      '{kennelPatterns}',
      (config->'kennelPatterns') || '[["Fool Moon","fool-moon-h3"]]'::jsonb
    ),
    "updatedAt" = NOW()
WHERE name = 'Aloha H3 Google Calendar' AND type::text = 'GOOGLE_CALENDAR'
  AND NOT ((config->'kennelPatterns') @> '[["Fool Moon","fool-moon-h3"]]'::jsonb);

-- 4. Re-route existing Fool Moon events off ah3-hi (reassign, don't delete). One event
--    today ("Fool Moon H3 #409", 2026-04-01); the title guard also catches any siblings.
--    EventKennel (the multi-kennel join) first, then the denormalized Event.kennelId.
UPDATE "EventKennel" ek
SET "kennelId" = fool.id
FROM "Event" e, "Kennel" ah, "Kennel" fool
WHERE ek."eventId" = e.id
  AND ah."kennelCode" = 'ah3-hi' AND fool."kennelCode" = 'fool-moon-h3'
  AND ek."kennelId" = ah.id
  AND e.title ILIKE 'Fool Moon%';

UPDATE "Event" e
SET "kennelId" = fool.id, "updatedAt" = NOW()
FROM "Kennel" ah, "Kennel" fool
WHERE ah."kennelCode" = 'ah3-hi' AND fool."kennelCode" = 'fool-moon-h3'
  AND e."kennelId" = ah.id
  AND e.title ILIKE 'Fool Moon%';

-- 5. Recompute cached lastEventDate for both kennels after the re-route.
UPDATE "Kennel" k
SET "lastEventDate" = sub.maxdate
FROM (
  SELECT "kennelId", MAX(date) AS maxdate
  FROM "Event"
  WHERE status::text <> 'CANCELLED'
  GROUP BY "kennelId"
) sub
WHERE k.id = sub."kennelId" AND k."kennelCode" IN ('ah3-hi', 'fool-moon-h3');

COMMIT;
