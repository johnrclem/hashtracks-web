-- Clear 4X2H4 broken website (#501).
-- 4x2h4.org returns connection timeout (curl exit 28). Removing the dead URL
-- so kennel cards stop linking to it. The Facebook group is the active
-- community channel and is already populated in Kennel.facebookUrl.

UPDATE "Kennel"
SET website = NULL
WHERE "kennelCode" = '4x2h4'
  AND website IS NOT NULL;

DO $$
DECLARE
  remaining text;
BEGIN
  SELECT website INTO remaining FROM "Kennel" WHERE "kennelCode" = '4x2h4';
  IF NOT FOUND THEN
    RAISE EXCEPTION '4x2h4 kennel row not found — refusing to silently no-op';
  END IF;
  IF remaining IS NOT NULL THEN
    RAISE EXCEPTION '4x2h4 website did not clear: %', remaining;
  END IF;
END $$;
