-- Kennel-row audit fixes that the seed merge logic (prisma/seed.ts:298-303
-- only fills null fields) cannot apply against existing non-null values.
-- Run manually against prod after the seed-update PR lands.
-- Closes #1106 (Edinburgh description), #1103 (DIM description),
-- #1030 (East Bay description + $$6 → $6), #1034 (Butterworth description).

BEGIN;

-- Sanity: refuse to update anything if any target kennelCode is missing.
-- This runs first so a stale rename aborts the entire batch atomically.
DO $$
DECLARE
  missing text[];
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY['edinburghh3','dim-h3','ebh3','butterworth-h3']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = code) THEN
      missing := array_append(missing, code);
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing kennelCode(s): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- Edinburgh H3 — drop stale "#2302+" run-number reference, replace with
-- verbatim source-derived prose (founder + history baked in since the
-- schema has no `founder` column).
UPDATE "Kennel"
SET "description" = 'Non-competitive fun-running club of around 100 members. Different location every Sunday at 11am within roughly a 40-mile radius of Edinburgh; runs are usually around 8km and followed by a pub lunch. Founded February 1981 by Willie Coupar (Surrey H3); hosted the Commonwealth Hash in 1986 and UK Nash Hashes in 1989 and 2009.'
WHERE "kennelCode" = 'edinburghh3';

-- DIM — replace thin one-liner with origin story + DST seasonality.
UPDATE "Kennel"
SET "description" = 'Damn It''s Monday — a Colorado Springs hash created in 1999 by P2H4''s Crack Climber as a summertime offshoot of Pikes Peak H4. Hibernates each winter and returns annually during Daylight Savings Time, hashing every other Monday at 6:00 PM. Trails tend toward the longer and more challenging end of the P2H4 family.'
WHERE "kennelCode" = 'dim-h3';

-- East Bay H3 — replace description-with-stale-run-number and conditionally
-- fix the "$$6" hashCash bug in a single atomic update.
UPDATE "Kennel"
SET "description" = 'One of the longest-running active hashes in the U.S., founded in 1979 (originally as the Alamo H3). Biweekly Sunday afternoon runs through East Bay open-space and parks, usually live trails, with circle and on-on-on at a nearby pub afterwards.',
    "hashCash" = CASE WHEN "hashCash" LIKE '$$%' THEN '$6' ELSE "hashCash" END
WHERE "kennelCode" = 'ebh3';

-- Butterworth H3 — bake founder + parent kennel + men-only into description
-- (no schema columns for those today).
UPDATE "Kennel"
SET "description" = 'Founded 29 May 1980 by Peter ''Jonsi'' Jones as a daughter kennel of Penang H3, Butterworth H3 is the men-only mainland-Penang hash. Weekly Saturday trails through Seberang Perai and the mainland Penang hinterland.'
WHERE "kennelCode" = 'butterworth-h3';

COMMIT;
