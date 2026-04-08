-- Set Kennel.logoUrl for 7H4 from the Google Sites og:image (#512).
-- The kennel's sites.google.com/view/7h4/home page publishes a stable
-- og:image URL pointing at the kennel's trail-footprint-with-mountains logo.
-- Seed file (prisma/seed-data/kennels.ts) is updated in the same PR.

UPDATE "Kennel"
SET "logoUrl" = 'https://lh3.googleusercontent.com/sitesv/APaQ0SRByve9d3YT-Sw3vn93RVKJUM909Mk0BfuVcfTG7gRlU7wUPH3_EdUMB5zfxujssaRdDVm3MC-o0_d9ePAdX-Z_kWi8G_qIyWkYmKg3ZNR7DdoEwiZjtBo4RkqcHyjvcZ5csUeqUIA3WRsXgojEFQznHMNTP2tYkng=w16383'
WHERE "kennelCode" = '7h4'
  AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

DO $$
DECLARE
  stored text;
BEGIN
  SELECT "logoUrl" INTO stored FROM "Kennel" WHERE "kennelCode" = '7h4';
  IF NOT FOUND THEN
    RAISE EXCEPTION '7h4 kennel row not found — refusing to silently no-op';
  END IF;
  IF NULLIF(BTRIM(stored), '') IS NULL OR BTRIM(stored) NOT LIKE 'https://%' THEN
    RAISE EXCEPTION '7h4 logoUrl did not land: %', COALESCE(stored, 'NULL');
  END IF;
END $$;
