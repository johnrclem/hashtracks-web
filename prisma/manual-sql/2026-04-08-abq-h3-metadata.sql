-- ABQ H3 kennel profile enrichment (#540).
-- Adds logoUrl + contactEmail, refreshes the schedule notes to include the
-- Tuesday CLiT and Full Moon Wednesday series, and replaces the stale
-- "Trail #1144+" description with a generic form that doesn't need
-- periodic maintenance.
--
-- Seed file (prisma/seed-data/kennels.ts) is updated in the same PR.
-- The WHERE clause is gated on the known stale values for each field so
-- re-runs are idempotent no-ops and admin-curated rows aren't clobbered.
-- The post-update DO block verifies the final state, so a row that was
-- already hand-curated into a "good" state still passes the verification
-- without this script having to touch it.

UPDATE "Kennel"
SET "logoUrl" = 'https://lh3.googleusercontent.com/sitesv/APaQ0SSjKwv9mC3ob6B7mYIrUIwvBcfgbcTnjs2H_OULVsQODFJgoy1zQ5v5bVZenvwBALsnG59DLUcK2T6oZKIHxoN-xssA0NATeoZF4OALdhbuVlBYZKoDkzP8-l4LgjOmm8-2uh3tde4vdSTBFJvnyEJ2bdWhntJZXs3evluFi3cw-tsBOqLKEnYT=w16383',
    "contactEmail" = 'abqh3misman@gmail.com',
    "scheduleNotes" = 'Saturdays at 2pm (1pm in winter). Tuesdays at 6pm year-round (CLiT). Full Moon trails on Wednesdays March-October at 6pm.',
    description = 'Albuquerque''s hash kennel. Saturday trails + Tuesday CLiT + monthly Full Moon Wednesdays.',
    "updatedAt" = NOW()
WHERE "kennelCode" = 'abqh3'
  AND "logoUrl" IS NULL
  AND "contactEmail" IS NULL
  AND "scheduleNotes" = 'Weekly in summer, biweekly in winter'
  AND description = 'Albuquerque''s hash kennel. Trail #1144+.';

DO $$
DECLARE
  stored_logo text;
  stored_email text;
BEGIN
  SELECT "logoUrl", "contactEmail" INTO stored_logo, stored_email
  FROM "Kennel" WHERE "kennelCode" = 'abqh3';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'abqh3 kennel row not found';
  END IF;
  IF NULLIF(BTRIM(stored_logo), '') IS NULL OR BTRIM(stored_logo) NOT LIKE 'https://%' THEN
    RAISE EXCEPTION 'abqh3 logoUrl did not land: %', COALESCE(stored_logo, 'NULL');
  END IF;
  IF stored_email IS DISTINCT FROM 'abqh3misman@gmail.com' THEN
    RAISE EXCEPTION 'abqh3 contactEmail did not land: %', COALESCE(stored_email, 'NULL');
  END IF;
END $$;
