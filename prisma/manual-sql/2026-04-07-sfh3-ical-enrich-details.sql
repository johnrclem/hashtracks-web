-- Enable SFH3 detail-page enrichment on the iCal source (#492, #493).
--
-- Background: the SFH3 HTML adapter already fetches sfh3.com/runs/{id} to get
-- the canonical "KENNEL Run #N" title and the Comment field. The iCal adapter
-- didn't, so when the merge pipeline picked the iCal RawEvent as canonical
-- (higher trustLevel: 8 > 7), the enriched values from the HTML source were
-- ignored and the canonical Event was left with "26.2H3 #7" instead of
-- "26.2H3 Run #7" and no Comment.
--
-- This migration sets enrichSFH3Details=true on the SFH3 MultiHash iCal Feed
-- source config so both adapters emit enriched RawEvents and the merge result
-- is correct regardless of which source wins.
--
-- The seed file (prisma/seed-data/sources.ts) is updated in the same PR so
-- fresh installs reproduce. Per convention `prisma db seed` is never run
-- against prod; production config is drifted via SQL one-shots like this.

UPDATE "Source"
SET config = jsonb_set(
  COALESCE(config, '{}'::jsonb),
  '{enrichSFH3Details}',
  'true'::jsonb,
  true
)
WHERE name = 'SFH3 MultiHash iCal Feed'
  AND type = 'ICAL_FEED';

-- Sanity check: fail loudly if zero rows were touched so a silent no-op can't
-- hide a source-rename drift from the seed file.
DO $$
DECLARE
  touched int;
BEGIN
  SELECT COUNT(*) INTO touched
  FROM "Source"
  WHERE name = 'SFH3 MultiHash iCal Feed'
    AND type = 'ICAL_FEED'
    AND (config->>'enrichSFH3Details')::boolean IS TRUE;
  IF touched = 0 THEN
    RAISE EXCEPTION 'SFH3 MultiHash iCal Feed config update did not land — source missing or renamed?';
  END IF;
END $$;
