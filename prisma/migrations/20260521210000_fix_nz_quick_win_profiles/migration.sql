-- NZ quick-win profile bundle (#1507, #1514, #1520, #1525, #1532) — converge
-- prod kennel fields with the refreshed seed data in prisma/seed-data/kennels.ts.
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows — it
-- never overwrites populated ones. Capital H3 has a stale foundedYear
-- (1979 → 1981 per the kennel's own history page), Geriatrix has a stale
-- scheduleTime (5:30 PM → 6:30 PM per the source's "Next Run"), and
-- several descriptions need refreshed copy that folds in hash cash prose.
-- A plain seed change wouldn't reach end users without this UPDATE.
--
-- The null-only fills (facebookUrl, logoUrl, contactEmail, and the
-- Geriatrix-only foundedYear since prod currently has it NULL) are also
-- issued here via COALESCE so Vercel's automatic `migrate deploy` pushes
-- them to prod without waiting for the next manual `prisma db seed`
-- (see memory: feedback_post_merge_seed_required.md). Capital H3's
-- foundedYear is a forced overwrite (1979 → 1981) handled separately
-- via `IS DISTINCT FROM` since the prod value is non-NULL.
--
-- Idempotency: `IS DISTINCT FROM` gates make re-application a no-op on
-- an already-corrected DB. A NOTICE surfaces missing-row situations on
-- fresh / preview DBs.

BEGIN;

-- ── #1520: Capital H3 — foundedYear 1979→1981, description, FB, logo ─────────
DO $$
DECLARE
  v_kennel_code         text := 'capital-h3-nz';
  v_correct_founded     int  := 1981;
  v_correct_description text := 'Founded 2 February 1981 by Mad Max with an inaugural run from the Thorndon Tavern (briefly in recess Nov 1981 until re-erected Sept 1983). Weekly Monday evening trails across Wellington and the wider Hutt Valley. Hash cash is $2 per run; food and drinks at the on-on are BYO.';
  v_facebook_url        text := 'https://www.facebook.com/Capitalhhh/';
  v_logo_url            text := 'https://prodcdn.sporty.co.nz/cms/3076/logo.png';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "foundedYear" = v_correct_founded,
      description   = v_correct_description,
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear" IS DISTINCT FROM v_correct_founded
      OR description IS DISTINCT FROM v_correct_description
    );

  UPDATE "Kennel"
  SET "facebookUrl" = COALESCE("facebookUrl", v_facebook_url),
      "logoUrl"     = COALESCE("logoUrl",     v_logo_url),
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("facebookUrl" IS NULL OR "logoUrl" IS NULL);
END $$;

-- ── #1507: Geriatrix H3 — scheduleTime, scheduleNotes, description, foundedYear, logo ──
DO $$
DECLARE
  v_kennel_code         text := 'geriatrix-h3';
  v_correct_time        text := '6:30 PM';
  v_correct_notes       text := 'Weekly Tuesday evenings at 6:30 PM. Each run lists venue, hare, and a map link.';
  v_correct_description text := 'Wellington''s relaxed-pace Tuesday hash — "the drinking club with a running problem," founded 24 September 1985. Shorter, accessible trails around Wellington and Lower Hutt. Hash cash is $2 (non piss-stop) or $4 (piss-stop) per run; home runs are $15–$20 (cashless, direct credit preferred).';
  v_correct_founded     int  := 1985;
  v_logo_url            text := 'https://prodcdn.sporty.co.nz/cms/5181/logo.gif';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "scheduleTime"  = v_correct_time,
      "scheduleNotes" = v_correct_notes,
      description     = v_correct_description,
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleTime"  IS DISTINCT FROM v_correct_time
      OR "scheduleNotes" IS DISTINCT FROM v_correct_notes
      OR description     IS DISTINCT FROM v_correct_description
    );

  UPDATE "Kennel"
  SET "foundedYear" = COALESCE("foundedYear", v_correct_founded),
      "logoUrl"     = COALESCE("logoUrl",     v_logo_url),
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("foundedYear" IS NULL OR "logoUrl" IS NULL);
END $$;

-- ── #1514: Auckland Hussies — description + contactEmail ─────────────────────
DO $$
DECLARE
  v_kennel_code         text := 'auckland-hussies';
  v_correct_description text := 'Auckland''s women-founded hash, established 1978. Weekly Tuesday evening trails across Auckland with a published run list. Mixed attendance though women-led. Hash cash is $15 when starting from home or a park (pay-as-you-go at restaurants and pubs), plus $5 for drinks.';
  v_contact_email       text := 'trailmaster@aucklandhussies.co.nz';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET description = v_correct_description,
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND description IS DISTINCT FROM v_correct_description;

  UPDATE "Kennel"
  SET "contactEmail" = COALESCE("contactEmail", v_contact_email),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "contactEmail" IS NULL;
END $$;

-- ── #1525: Hibiscus H3 — description (folds in "no fees" hash cash prose) ────
DO $$
DECLARE
  v_kennel_code         text := 'hibiscus-h3';
  v_correct_description text := 'Hibiscus Coast hash kennel covering Orewa, Whangaparaoa, and the northern Auckland coast. Weekly Monday evening trails since 1987. No fees, no committee — an optional post-run meal and drinks are pay-as-you-go.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET description = v_correct_description,
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND description IS DISTINCT FROM v_correct_description;
END $$;

-- ── #1532: Christchurch H3 — facebookUrl (group link) ────────────────────────
DO $$
DECLARE
  v_kennel_code  text := 'christchurch-h3';
  v_facebook_url text := 'https://www.facebook.com/groups/155409764478320/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "facebookUrl" = COALESCE("facebookUrl", v_facebook_url),
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "facebookUrl" IS NULL;
END $$;

COMMIT;
