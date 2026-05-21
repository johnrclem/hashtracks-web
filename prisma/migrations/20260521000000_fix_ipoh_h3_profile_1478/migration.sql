-- Ipoh H3 profile bundle (#1478) — converge prod kennel fields with the
-- refreshed seed data in prisma/seed-data/kennels.ts.
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows — it
-- never overwrites populated ones. Ipoh has stale Saturday/17:00 schedule
-- strings + Saturday-mentioning description in prod, so a plain seed
-- change wouldn't reach end users. Closes seams #1 and #2 documented in
-- the #1477 migration header (20260520210000_fix_ipoh_h3_schedule_1477).
--
-- Idempotency: `IS DISTINCT FROM` gates make re-application a no-op on
-- an already-corrected DB. A NOTICE surfaces missing-row situations on
-- fresh / preview DBs.

BEGIN;

DO $$
DECLARE
  v_kennel_code         text := 'ipoh-h3';
  v_correct_dow         text := 'Monday';
  v_correct_time        text := '6:00 PM';
  v_correct_notes       text := 'Weekly Monday evening trails (men''s chapter). Founded 31 Jan 1965.';
  v_correct_description text := 'Founded in 1965 in Perak, Ipoh H3 is one of Malaysia''s oldest hash kennels — a men-only chapter exploring the limestone hills and jungle trails around Ipoh. Trail details are typically shared by phone or WhatsApp the day of the run; the malaysiahash.com directory is the most up-to-date public listing.';
  v_logo_url            text := '/kennel-logos/ipoh-h3.jpg';
  v_contact_email       text := 'ipohhhh@yahoo.com';
  v_founder             text := 'David R. ''Mad Dog'' Denning';
  v_parent_code         text := 'motherh3';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Schedule + description converge: overwrite the four fields the seed
  -- merge cannot reach. `IS DISTINCT FROM` ensures the migration is a
  -- no-op on a DB that's already been corrected (e.g. via the next seed
  -- run on a fresh local copy).
  UPDATE "Kennel"
  SET "scheduleDayOfWeek" = v_correct_dow,
      "scheduleTime"      = v_correct_time,
      "scheduleNotes"     = v_correct_notes,
      description         = v_correct_description,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleDayOfWeek" IS DISTINCT FROM v_correct_dow
      OR "scheduleTime"   IS DISTINCT FROM v_correct_time
      OR "scheduleNotes"  IS DISTINCT FROM v_correct_notes
      OR description      IS DISTINCT FROM v_correct_description
    );

  -- New optional profile fields: only fill when currently NULL so a later
  -- admin edit (e.g. updating contactEmail to a new mailing alias) isn't
  -- stomped on the next deploy.
  UPDATE "Kennel"
  SET "logoUrl"          = COALESCE("logoUrl", v_logo_url),
      "contactEmail"     = COALESCE("contactEmail", v_contact_email),
      founder            = COALESCE(founder, v_founder),
      "parentKennelCode" = COALESCE("parentKennelCode", v_parent_code),
      "updatedAt"        = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "logoUrl"          IS NULL
      OR "contactEmail"  IS NULL
      OR founder         IS NULL
      OR "parentKennelCode" IS NULL
    );
END $$;

COMMIT;
