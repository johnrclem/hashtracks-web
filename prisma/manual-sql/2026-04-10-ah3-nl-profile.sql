-- Amsterdam H3 kennel profile enrichment (#564).
-- Adds Facebook group URL and logo URL from ah3.nl.
-- Uses COALESCE so admin-curated values are not overwritten.

UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/AmsterdamH3'),
    "logoUrl" = COALESCE("logoUrl", 'https://ah3.nl/wp-content/uploads/2022/03/cropped-Amsterdam-original-192x192.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'ah3-nl'
  AND (
    NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("logoUrl"), '') IS NULL
  );

DO $$
DECLARE
  stored_fb text;
  stored_logo text;
BEGIN
  SELECT "facebookUrl", "logoUrl"
    INTO stored_fb, stored_logo
  FROM "Kennel" WHERE "kennelCode" = 'ah3-nl';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ah3-nl kennel row not found';
  END IF;
  IF NULLIF(BTRIM(stored_fb), '') IS NULL THEN
    RAISE EXCEPTION 'ah3-nl facebookUrl is still null/empty after update';
  END IF;
  IF NULLIF(BTRIM(stored_logo), '') IS NULL THEN
    RAISE EXCEPTION 'ah3-nl logoUrl is still null/empty after update';
  END IF;
END $$;
