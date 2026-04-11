-- Adelaide H3 kennel profile enrichment (#605, #606).
-- Sources: ah3.com.au homepage + /a-little-history/ + Facebook page.

BEGIN;

UPDATE "Kennel"
SET "facebookUrl" = COALESCE(NULLIF(BTRIM("facebookUrl"), ''), 'https://www.facebook.com/adelaidehash'),
    "logoUrl" = COALESCE(NULLIF(BTRIM("logoUrl"), ''), 'https://ah3.com.au/wp-content/uploads/2014/11/ah3lgo_2.gif'),
    "contactEmail" = COALESCE(NULLIF(BTRIM("contactEmail"), ''), 'moped@ah3.com.au'),
    "foundedYear" = COALESCE("foundedYear", 1978),
    "hashCash" = COALESCE(NULLIF(BTRIM("hashCash"), ''), '$25 drinkers / $15 non-drinkers'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'ah3-au'
  AND (
    NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR "foundedYear" IS NULL
    OR NULLIF(BTRIM("hashCash"), '') IS NULL
  );

DO $$
DECLARE
  r record;
BEGIN
  SELECT "facebookUrl", "logoUrl", "contactEmail", "foundedYear", "hashCash"
    INTO r FROM "Kennel" WHERE "kennelCode" = 'ah3-au';
  IF NOT FOUND THEN RAISE EXCEPTION 'ah3-au kennel not found'; END IF;
  IF NULLIF(BTRIM(r."facebookUrl"), '') IS NULL THEN RAISE EXCEPTION 'facebookUrl empty'; END IF;
  IF NULLIF(BTRIM(r."logoUrl"), '') IS NULL THEN RAISE EXCEPTION 'logoUrl empty'; END IF;
  IF NULLIF(BTRIM(r."contactEmail"), '') IS NULL THEN RAISE EXCEPTION 'contactEmail empty'; END IF;
  IF r."foundedYear" IS NULL THEN RAISE EXCEPTION 'foundedYear null'; END IF;
  IF NULLIF(BTRIM(r."hashCash"), '') IS NULL THEN RAISE EXCEPTION 'hashCash empty'; END IF;
END $$;

COMMIT;
