-- Agnews kennel profile enrichment (#547, #551).
-- svh3.com (the Silicon Valley Hash umbrella site) lists the Facebook page,
-- X/Twitter handle, mismanagement contact emails, and hash cash. Fold those
-- into the Agnews kennel row. Also drop the stale "Run #1510+" suffix from
-- the description — the kennel is already past that and the static count
-- would just keep getting more wrong.
--
-- Seed file (prisma/seed-data/kennels.ts) is updated in the same PR.
--
-- Idempotency (Codex review on PR #552):
--   - Each social/contact field uses COALESCE so the update only fills NULLs.
--     Any row where an admin has already curated one of these fields keeps
--     its existing value.
--   - The description UPDATE only fires on the exact stale string, leaving
--     any hand-curated description alone.
--   - The verification block asserts the fields are non-null (not that they
--     equal this script's preferred values) and that the stale "#1510+"
--     suffix is gone. A pre-curated row passes verification as long as the
--     data is present in some form.

UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/SIliconeValleyHash'),
    "twitterHandle" = COALESCE("twitterHandle", '@SiliconValleyH3'),
    "contactEmail" = COALESCE("contactEmail", 'hareraiser@svh3.com'),
    "hashCash" = COALESCE("hashCash", '$6.00'),
    description = CASE
      WHEN description = 'Biweekly Thursday evening hash in the South Bay. Longer trails, more family-friendly. Alternates with FHAC-U. Run #1510+.'
        THEN 'Biweekly Thursday evening hash in the South Bay. Longer trails, more family-friendly. Alternates with FHAC-U.'
      ELSE description
    END,
    "updatedAt" = NOW()
WHERE "kennelCode" = 'agnews';

DO $$
DECLARE
  stored_hash_cash text;
  stored_fb text;
  stored_twitter text;
  stored_email text;
  stored_desc text;
BEGIN
  SELECT "hashCash", "facebookUrl", "twitterHandle", "contactEmail", description
    INTO stored_hash_cash, stored_fb, stored_twitter, stored_email, stored_desc
  FROM "Kennel" WHERE "kennelCode" = 'agnews';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agnews kennel row not found';
  END IF;
  -- Assert the fields are populated (any non-null value counts — handles
  -- rows that were admin-curated with different-but-valid values).
  IF NULLIF(BTRIM(stored_hash_cash), '') IS NULL THEN
    RAISE EXCEPTION 'agnews hashCash is still null/empty after update';
  END IF;
  IF NULLIF(BTRIM(stored_fb), '') IS NULL THEN
    RAISE EXCEPTION 'agnews facebookUrl is still null/empty after update';
  END IF;
  IF NULLIF(BTRIM(stored_twitter), '') IS NULL THEN
    RAISE EXCEPTION 'agnews twitterHandle is still null/empty after update';
  END IF;
  IF NULLIF(BTRIM(stored_email), '') IS NULL THEN
    RAISE EXCEPTION 'agnews contactEmail is still null/empty after update';
  END IF;
  -- The stale suffix is the one thing we insist on removing regardless of
  -- whether the row was admin-curated.
  IF stored_desc LIKE '%Run #1510+%' THEN
    RAISE EXCEPTION 'agnews description still has stale Run #1510+ suffix: %', stored_desc;
  END IF;
END $$;
