-- Audit batch skipPatterns — Philly H3 Google Calendar (#582) + Oregon Hashing Calendar (#584).
--
-- Both sources are shared community calendars that include sister-kennel
-- events whose titles get misattributed to the default kennel. The fix is
-- a skipPatterns array anchored to start-of-title, so foreign-kennel-only
-- events are dropped before kennel resolution while joint co-host trails
-- whose titles mention both kennels stay put.
--
-- Seed file (prisma/seed-data/sources.ts) is updated in the same PR so
-- fresh installs reproduce. This SQL patches prod where admin-UI drift
-- may have edited other config keys; jsonb_set only touches skipPatterns,
-- preserving kennelPatterns / defaultKennelTag / any other field.
--
-- Idempotent: re-running is safe because jsonb_set overwrites the same
-- key with the same value.

-- #582 Philly H3 — drop BFM events that leak in from the shared calendar.
UPDATE "Source"
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{skipPatterns}',
  '["^Ben Franklin Mob H3\\b", "^BFM\\b"]'::jsonb,
  true
)
WHERE name = 'Philly H3 Google Calendar'
  AND type = 'GOOGLE_CALENDAR';

-- #584 Oregon Hashing Calendar — drop N2H3 / NNH3 events.
UPDATE "Source"
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{skipPatterns}',
  '["^NNH3\\b", "^N2H3\\b", "^No Name\\b"]'::jsonb,
  true
)
WHERE name = 'Oregon Hashing Calendar'
  AND type = 'GOOGLE_CALENDAR';

-- Verify the skipPatterns landed AND that we did NOT clobber the adjacent
-- config keys. Raise an exception loudly if either kennelPatterns or
-- defaultKennelTag disappeared.
DO $$
DECLARE
  philly_skip jsonb;
  philly_kennel jsonb;
  philly_default text;
  oregon_skip jsonb;
  oregon_kennel jsonb;
  oregon_default text;
BEGIN
  SELECT
    config->'skipPatterns', config->'kennelPatterns', config->>'defaultKennelTag'
  INTO philly_skip, philly_kennel, philly_default
  FROM "Source"
  WHERE name = 'Philly H3 Google Calendar' AND type = 'GOOGLE_CALENDAR';

  IF philly_skip IS NULL OR jsonb_array_length(philly_skip) <> 2 THEN
    RAISE EXCEPTION 'Philly skipPatterns not applied: %', philly_skip;
  END IF;
  IF philly_kennel IS NULL OR jsonb_array_length(philly_kennel) = 0 THEN
    RAISE EXCEPTION 'Philly kennelPatterns was clobbered: %', philly_kennel;
  END IF;
  IF philly_default <> 'philly-h3' THEN
    RAISE EXCEPTION 'Philly defaultKennelTag was clobbered: %', philly_default;
  END IF;

  SELECT
    config->'skipPatterns', config->'kennelPatterns', config->>'defaultKennelTag'
  INTO oregon_skip, oregon_kennel, oregon_default
  FROM "Source"
  WHERE name = 'Oregon Hashing Calendar' AND type = 'GOOGLE_CALENDAR';

  IF oregon_skip IS NULL OR jsonb_array_length(oregon_skip) <> 3 THEN
    RAISE EXCEPTION 'Oregon skipPatterns not applied: %', oregon_skip;
  END IF;
  IF oregon_kennel IS NULL OR jsonb_array_length(oregon_kennel) = 0 THEN
    RAISE EXCEPTION 'Oregon kennelPatterns was clobbered: %', oregon_kennel;
  END IF;
  IF oregon_default <> 'oh3' THEN
    RAISE EXCEPTION 'Oregon defaultKennelTag was clobbered: %', oregon_default;
  END IF;
END $$;
