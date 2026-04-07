-- Add 4X2H4-specific runNumberPatterns to the Chicagoland Hash Calendar source
-- config (#496, #497). The 4X2H4 calendar puts run numbers in a "What: 4x2 H4
-- No. 124" line in the description body — the existing default summary regex
-- (#NNN) doesn't catch it. Pattern is anchored to "4x2 H4 No." so other
-- Chicagoland kennels can't accidentally match.
--
-- Seed file (prisma/seed-data/sources.ts) is updated in the same PR; per
-- convention prod config drifts via SQL one-shots and `prisma db seed` is
-- never run against prod.

UPDATE "Source"
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{runNumberPatterns}',
  '["What:\\s*4x2\\s*H4\\s*No\\.?\\s*(\\d+)"]'::jsonb,
  true
)
WHERE name = 'Chicagoland Hash Calendar'
  AND type = 'GOOGLE_CALENDAR';

DO $$
DECLARE
  patterns jsonb;
BEGIN
  SELECT config->'runNumberPatterns' INTO patterns
  FROM "Source"
  WHERE name = 'Chicagoland Hash Calendar' AND type = 'GOOGLE_CALENDAR';
  IF patterns IS NULL OR jsonb_array_length(patterns) = 0 THEN
    RAISE EXCEPTION 'Chicagoland Hash Calendar runNumberPatterns did not land — source missing or renamed?';
  END IF;
END $$;
