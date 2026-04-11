-- Aloha H3 kennel profile enrichment (#574, #579).
-- Adds logo URL (WordPress og:image) and contact email from alohah3.com.
-- Uses COALESCE so admin-curated values are not overwritten.
-- Wrapped in an explicit transaction so the UPDATE + verification are
-- all-or-nothing even in autocommit contexts.

BEGIN;

UPDATE "Kennel"
SET "logoUrl" = COALESCE(NULLIF(BTRIM("logoUrl"), ''), 'https://alohah3.com/wp-content/uploads/2023/10/FB-Link-Sharing-Photo-homepage.png'),
    "contactEmail" = COALESCE(NULLIF(BTRIM("contactEmail"), ''), 'alohahhh@gmail.com'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'ah3-hi'
  AND (
    NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
  );

DO $$
DECLARE
  stored_logo text;
  stored_email text;
BEGIN
  SELECT "logoUrl", "contactEmail"
    INTO stored_logo, stored_email
  FROM "Kennel" WHERE "kennelCode" = 'ah3-hi';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ah3-hi kennel row not found';
  END IF;
  IF NULLIF(BTRIM(stored_logo), '') IS NULL THEN
    RAISE EXCEPTION 'ah3-hi logoUrl is still null/empty after update';
  END IF;
  IF NULLIF(BTRIM(stored_email), '') IS NULL THEN
    RAISE EXCEPTION 'ah3-hi contactEmail is still null/empty after update';
  END IF;
END $$;

COMMIT;
