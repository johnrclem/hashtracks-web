-- Enable 4X2H4 inline hareline back-fill on the Chicagoland calendar (#498).
-- Only the soonest-upcoming 4X2H4 event carries a populated description, which
-- contains a "4x2 H4 Hareline:" block listing future dates and their hares.
-- The gcal adapter's scrape-post-pass reads that block and back-fills hares on
-- matching-date events for the same kennelTag. Non-destructive: existing hares
-- are never overwritten.
--
-- Seed file (prisma/seed-data/sources.ts) is updated in the same PR so fresh
-- installs reproduce.

UPDATE "Source"
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{inlineHarelinePattern}',
  '{"kennelTag": "4x2h4", "blockHeader": "4x2 H4 Hareline:"}'::jsonb,
  true
)
WHERE name = 'Chicagoland Hash Calendar'
  AND type = 'GOOGLE_CALENDAR';

DO $$
DECLARE
  pattern jsonb;
BEGIN
  SELECT config->'inlineHarelinePattern' INTO pattern
  FROM "Source"
  WHERE name = 'Chicagoland Hash Calendar' AND type = 'GOOGLE_CALENDAR';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Chicagoland Hash Calendar source row not found — refusing to silently no-op';
  END IF;
  IF pattern IS NULL OR pattern->>'kennelTag' <> '4x2h4' THEN
    RAISE EXCEPTION 'inlineHarelinePattern did not land as expected: %', pattern;
  END IF;
END $$;
