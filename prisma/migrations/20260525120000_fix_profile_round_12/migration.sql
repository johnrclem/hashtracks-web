-- Profile Round 12 quick-win bundle (#1608, #1616, #1619, #1631, #1638, #1656) —
-- converge prod kennel fields with the refreshed seed data in
-- prisma/seed-data/kennels.ts.
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows — it
-- never overwrites populated ones. MH3-MN has a stale foundedYear
-- (1989 → 1990 per the kennel's own About page), and all six kennels
-- (LBH3, Melbourne New Moon, MGH4, MH3-MN, MFMH3, MASS H3) need refreshed
-- descriptions that fold in hash-cash prose, taglines, and founder/expansion
-- detail. A plain seed change wouldn't reach end users without this UPDATE.
--
-- The null-only fills (contactEmail, contactName, logoUrl, scheduleNotes,
-- foundedYear where prod is still NULL) are also issued here via COALESCE so
-- Vercel's automatic `migrate deploy` pushes them to prod without waiting
-- for the next manual `prisma db seed` (see memory:
-- feedback_post_merge_seed_required.md).
--
-- Idempotency: `IS DISTINCT FROM` gates make re-application a no-op on an
-- already-corrected DB. A NOTICE surfaces missing-row situations on fresh /
-- preview DBs.

BEGIN;

-- ── #1608: Long Beach H3 — description, foundedYear, scheduleNotes, contactEmail, logoUrl ──
DO $$
DECLARE
  v_kennel_code         text := 'lbh3';
  v_correct_description text := 'Founded January 6, 1985 by Dal "Jock" Trader, Jerry "Eject" Templeman, and Andy "Zapata" Limon. Runs Thursday evening during Spring/Summer and Sunday morning in the Fall/Winter, often with 50+ attendance. Visitors and virgins always welcome. Hash cash is $5 via cash or Venmo. Also hosts the SoCal calendar aggregator at lbh3.org/socal.';
  v_correct_founded     int  := 1985;
  v_correct_notes       text := 'Thursday evening during Spring/Summer & Sunday morning in the Fall/Winter.';
  v_contact_email       text := 'contact@lbh3.org';
  v_logo_url            text := '/kennel-logos/lbh3.png';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET description   = v_correct_description,
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND description IS DISTINCT FROM v_correct_description;

  UPDATE "Kennel"
  SET "foundedYear"  = COALESCE("foundedYear",  v_correct_founded),
      "scheduleNotes" = COALESCE("scheduleNotes", v_correct_notes),
      "contactEmail" = COALESCE("contactEmail", v_contact_email),
      "logoUrl"      = COALESCE("logoUrl",      v_logo_url),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear"   IS NULL
      OR "scheduleNotes" IS NULL
      OR "contactEmail" IS NULL
      OR "logoUrl"      IS NULL
    );
END $$;

-- ── #1616: Melbourne New Moon — description, scheduleNotes, scheduleTime, contactName ──
DO $$
DECLARE
  v_kennel_code         text := 'mel-new-moon';
  v_correct_description text := 'Melbourne New Moon HHH — Melbourne''s city-runners new-moon kennel. A drinking club with a running problem: each run is a mystery fun run, with a known start but trail marks leading you somewhere unknown (beware false trails). Hash cash is $5 to cover the circle beers.';
  v_correct_notes       text := 'Saturday nearest the new moon.';
  v_correct_time        text := '3:00 PM';
  v_contact_name        text := 'John 0411 143744';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET description     = v_correct_description,
      "scheduleNotes" = v_correct_notes,
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      description     IS DISTINCT FROM v_correct_description
      OR "scheduleNotes" IS DISTINCT FROM v_correct_notes
    );

  UPDATE "Kennel"
  SET "scheduleTime" = COALESCE("scheduleTime", v_correct_time),
      "contactName"  = COALESCE("contactName",  v_contact_name),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("scheduleTime" IS NULL OR "contactName" IS NULL);
END $$;

-- ── #1619: MGH4 — description, foundedYear, hashCash, scheduleNotes, facebookUrl ──
DO $$
DECLARE
  v_kennel_code         text := 'mgh4';
  v_correct_description text := 'Middle Georgia''s hash kennel, established 2001. Runs every Wednesday plus alternate Saturdays in the Macon area.';
  v_correct_founded     int  := 2001;
  v_correct_hash_cash   text := '$5';
  v_correct_notes       text := 'Every Wednesday, every other Saturday.';
  v_facebook_url        text := 'https://www.facebook.com/groups/middlegeorgiahash';
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
  SET "foundedYear"   = COALESCE("foundedYear",   v_correct_founded),
      "hashCash"      = COALESCE("hashCash",      v_correct_hash_cash),
      "scheduleNotes" = COALESCE("scheduleNotes", v_correct_notes),
      "facebookUrl"   = COALESCE("facebookUrl",   v_facebook_url),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear"   IS NULL
      OR "hashCash"      IS NULL
      OR "scheduleNotes" IS NULL
      OR "facebookUrl"   IS NULL
    );
END $$;

-- ── #1631: MH3-MN — foundedYear 1989→1990, description, scheduleNotes, contactEmail, logoUrl ──
DO $$
DECLARE
  v_kennel_code         text := 'mh3-mn';
  v_correct_founded     int  := 1990;
  v_correct_description text := 'Minneapolis''s flagship weekly Sunday hash — "Drink, R*n, Be Merry." Founded May 1990. A drinking club with a running problem: hashers meet roughly once a week and run/jog/walk a short course, then stand around chatting and drinking. Hash cash: visitors and virgins are free; returning visitors and members are $6.';
  v_correct_notes       text := '3 PM during DST; 2 PM when DST ends (fall).';
  v_contact_email       text := 'minneapolishash@gmail.com';
  v_logo_url            text := '/kennel-logos/mh3-mn.jpg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "foundedYear"   = v_correct_founded,
      description     = v_correct_description,
      "scheduleNotes" = v_correct_notes,
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear"   IS DISTINCT FROM v_correct_founded
      OR description     IS DISTINCT FROM v_correct_description
      OR "scheduleNotes" IS DISTINCT FROM v_correct_notes
    );

  UPDATE "Kennel"
  SET "contactEmail" = COALESCE("contactEmail", v_contact_email),
      "logoUrl"      = COALESCE("logoUrl",      v_logo_url),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("contactEmail" IS NULL OR "logoUrl" IS NULL);
END $$;

-- ── #1656: MFMH3 — description, scheduleNotes, contactEmail ──────────────────
DO $$
DECLARE
  v_kennel_code         text := 'mfmh3';
  v_correct_description text := 'Munich''s monthly full-moon hash — a drinking club with a running problem that meets in and around the Munich city center on the Friday nearest the full moon. A separate kennel from Munich H3.';
  v_correct_notes       text := 'Meets once a month, on a Friday nearest the full moon.';
  v_contact_email       text := 'fullmoon@munich-h3.com';
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
  SET "scheduleNotes" = COALESCE("scheduleNotes", v_correct_notes),
      "contactEmail"  = COALESCE("contactEmail",  v_contact_email),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("scheduleNotes" IS NULL OR "contactEmail" IS NULL);
END $$;

-- ── #1638: MASS H3 — description (expansion), scheduleNotes, structured schedule reconcile ──
-- Codex P2 (PR #1684 review): prior prod row carried `scheduleDayOfWeek=Saturday`,
-- `scheduleTime=3:00 PM`, `scheduleFrequency=Biweekly`, but the verbatim source
-- (Bavaria HHH FB group description; shared hareline sheet shows 3 events/12mo)
-- describes a non-regular hash. Clear the misleading day/time fields and mark
-- frequency as Irregular to match the prose. fullName "AsiaSammstagsHasch"
-- (Sammstag = German "Saturday") still records the kennel-name etymology.
DO $$
DECLARE
  v_kennel_code         text := 'massh3';
  v_correct_description text := 'MASS H3 — Munich''s Alternative Sunday Service. A non-regular Munich-area kennel with sporadic trails announced short-notice through the Munich H3 FB group.';
  v_correct_notes       text := 'Non-regular hash — trails are announced short-notice via the Munich H3 Facebook group.';
  v_correct_frequency   text := 'Irregular';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET description       = v_correct_description,
      "scheduleFrequency" = v_correct_frequency,
      "scheduleDayOfWeek" = NULL,
      "scheduleTime"      = NULL,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      description           IS DISTINCT FROM v_correct_description
      OR "scheduleFrequency" IS DISTINCT FROM v_correct_frequency
      OR "scheduleDayOfWeek" IS NOT NULL
      OR "scheduleTime"      IS NOT NULL
    );

  UPDATE "Kennel"
  SET "scheduleNotes" = COALESCE("scheduleNotes", v_correct_notes),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "scheduleNotes" IS NULL;
END $$;

COMMIT;
