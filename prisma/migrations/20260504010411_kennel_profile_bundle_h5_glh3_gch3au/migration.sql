-- Kennel profile bundle: H5 (#1204), GLH3 (#1206), Gold Coast H3 (#1226).
--
-- Pure data migration. Fills profile fields the seed merge cannot reach on
-- existing rows (prisma/seed.ts only fills NULLs) and corrects two stale
-- descriptions. Runs automatically via `prisma migrate deploy` on Vercel.
--
-- Idempotency:
--   * Profile fields use COALESCE — they only fill if the row is still NULL,
--     so admin-curated values are preserved on re-run.
--   * Description rewrites use a CASE that matches the exact stale string,
--     so any admin edit since the audit is left alone.
--   * The verification DO block asserts post-state, not equality with our
--     preferred values, so a pre-curated row passes as long as the field is
--     populated.
--
-- Seed file (prisma/seed-data/kennels.ts) holds the same canonical strings
-- so future fresh DBs land identical data via `npx prisma db seed`.

BEGIN;

-- Sanity: refuse the migration if any target row is missing.
DO $$
DECLARE
  missing text[];
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY['h5-hash','glh3','gch3-au']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = code) THEN
      missing := array_append(missing, code);
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing kennelCode(s): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- H5 (#1204): fill foundedYear + facebookUrl; expand description if still stale.
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1997),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/h5rocks'),
    description = CASE
      WHEN description = 'Biweekly hash in the Harrisburg/Hershey area.'
        THEN 'Harrisburg/Hershey biweekly hash since March 1997. A drinking club with a running problem.'
      ELSE description
    END,
    "updatedAt" = NOW()
WHERE "kennelCode" = 'h5-hash'
  AND (
    "foundedYear" IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR description = 'Biweekly hash in the Harrisburg/Hershey area.'
  );

-- GLH3 (#1206): fill logoUrl.
UPDATE "Kennel"
SET "logoUrl" = COALESCE(
      "logoUrl",
      'https://images.squarespace-cdn.com/content/v1/5976305e725e25e03b77f0ca/1587492643561-4KPIMV5IUHP8YR8V561W/GLH3+Logo.png?format=1500w'
    ),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'glh3'
  AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- Gold Coast H3 (#1226): fill foundedYear + facebookUrl + logoUrl; replace
-- factually wrong description ("mixed" → men-only; remove stale "approaching
-- Run #2500") only if still on the audited stale string.
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1978),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/gch3thegourmehash'),
    "logoUrl" = COALESCE(
      "logoUrl",
      'https://www.goldcoasthash.org/wp-content/uploads/The-Royal-Header1.png'
    ),
    description = CASE
      WHEN description = 'Gold Coast''s mixed hash kennel in Queensland. Weekly runs around the Gold Coast metro and hinterland, currently approaching Run #2500.'
        THEN 'The Gourmet Hash — Gold Coast''s men-only Hash kennel in Queensland, established 1978. Runs every Monday night, wet or fine, starting at 6:00 pm.'
      ELSE description
    END,
    "updatedAt" = NOW()
WHERE "kennelCode" = 'gch3-au'
  AND (
    "foundedYear" IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR description = 'Gold Coast''s mixed hash kennel in Queensland. Weekly runs around the Gold Coast metro and hinterland, currently approaching Run #2500.'
  );

-- Verify post-state. Assert the fields that were null in the audit are now
-- populated. Don't equality-check description — admin curation is allowed.
DO $$
DECLARE
  h5_year integer;
  h5_fb text;
  glh3_logo text;
  gc_year integer;
  gc_fb text;
  gc_logo text;
  gc_desc text;
BEGIN
  SELECT "foundedYear", "facebookUrl"
    INTO h5_year, h5_fb
  FROM "Kennel" WHERE "kennelCode" = 'h5-hash';
  IF h5_year IS NULL THEN
    RAISE EXCEPTION 'h5-hash foundedYear is still null after migration';
  END IF;
  IF NULLIF(BTRIM(h5_fb), '') IS NULL THEN
    RAISE EXCEPTION 'h5-hash facebookUrl is still null/empty after migration';
  END IF;

  SELECT "logoUrl" INTO glh3_logo FROM "Kennel" WHERE "kennelCode" = 'glh3';
  IF NULLIF(BTRIM(glh3_logo), '') IS NULL THEN
    RAISE EXCEPTION 'glh3 logoUrl is still null/empty after migration';
  END IF;

  SELECT "foundedYear", "facebookUrl", "logoUrl", description
    INTO gc_year, gc_fb, gc_logo, gc_desc
  FROM "Kennel" WHERE "kennelCode" = 'gch3-au';
  IF gc_year IS NULL THEN
    RAISE EXCEPTION 'gch3-au foundedYear is still null after migration';
  END IF;
  IF NULLIF(BTRIM(gc_fb), '') IS NULL THEN
    RAISE EXCEPTION 'gch3-au facebookUrl is still null/empty after migration';
  END IF;
  IF NULLIF(BTRIM(gc_logo), '') IS NULL THEN
    RAISE EXCEPTION 'gch3-au logoUrl is still null/empty after migration';
  END IF;
  -- The factual error in the original Gold Coast description is the one
  -- thing we insist on removing regardless of curation state.
  IF gc_desc LIKE '%mixed hash kennel%' THEN
    RAISE EXCEPTION 'gch3-au description still contains "mixed hash kennel": %', gc_desc;
  END IF;
END $$;

COMMIT;
