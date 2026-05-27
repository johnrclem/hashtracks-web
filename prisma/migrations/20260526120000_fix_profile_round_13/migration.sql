-- Profile Round 13 quick-win bundle (#1662, #1665, #1672, #1675, #1700, #1703) —
-- converge prod kennel fields with the refreshed seed data in
-- prisma/seed-data/kennels.ts.
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows — it
-- never overwrites populated ones. Several rewrites here change non-NULL
-- prod values (mh4-sd shortName, mooloo-h3 description, moooouston-h3
-- scheduleFrequency + description, mosquito-h3 description), and a plain
-- seed change wouldn't reach end users without these UPDATEs.
--
-- The null-only fills (foundedYear, hashCash, contactEmail, contactName,
-- signatureEvent, facebookUrl, logoUrl, scheduleNotes where prod is still
-- NULL) are also issued here via COALESCE so Vercel's automatic
-- `migrate deploy` pushes them to prod without waiting for the next manual
-- `prisma db seed` (see memory: feedback_post_merge_seed_required.md).
--
-- Idempotency: `IS DISTINCT FROM` gates make re-application a no-op on an
-- already-corrected DB. A NOTICE surfaces missing-row situations on fresh /
-- preview DBs.

BEGIN;

-- ── #1662: MiHiHuHa — null-fills only (foundedYear, hashCash, contactEmail, scheduleNotes) ──
DO $$
DECLARE
  v_kennel_code         text := 'mihi-huha';
  v_founded             int  := 2014;
  v_hash_cash           text := '$5';
  v_contact_email       text := 'huhahareraiser@gmail.com';
  v_schedule_notes      text := 'Wednesdays. Meet at 7:00 PM, hares away at 7:15, pack away at 7:30.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "foundedYear"   = COALESCE("foundedYear",   v_founded),
      "hashCash"      = COALESCE("hashCash",      v_hash_cash),
      "contactEmail"  = COALESCE("contactEmail",  v_contact_email),
      "scheduleNotes" = COALESCE("scheduleNotes", v_schedule_notes),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear"   IS NULL
      OR "hashCash"      IS NULL
      OR "contactEmail"  IS NULL
      OR "scheduleNotes" IS NULL
    );
END $$;

-- ── #1665: Mission H4 → Mission Harriettes — shortName + description rewrite + null-fills ──
-- Slug intentionally not rewritten: prod has slug "mission-h4" with established
-- URL/SEO history; the seed pins `slug: "mission-h4"` so fresh DBs converge.
DO $$
DECLARE
  v_kennel_code         text := 'mh4-sd';
  v_correct_short_name  text := 'Mission Harriettes';
  v_correct_description text := 'Mission Harriettes — San Diego''s women-only monthly hash, founded November 10, 1990 (per sdh3.com history). Wednesdays once a month, 6:30 PM start.';
  v_founded             int  := 1990;
  v_contact_name        text := 'Pith Me';
  v_signature_event     text := 'Turnover Hash (June/Late Summer)';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- foundedYear treated as override (per Round 12 MH3-MN precedent): the issue
  -- body's math-derived 1991 was wrong; sdh3.com history is canonical at 1990.
  UPDATE "Kennel"
  SET "shortName"   = v_correct_short_name,
      description   = v_correct_description,
      "foundedYear" = v_founded,
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "shortName"   IS DISTINCT FROM v_correct_short_name
      OR description   IS DISTINCT FROM v_correct_description
      OR "foundedYear" IS DISTINCT FROM v_founded
    );

  UPDATE "Kennel"
  SET "contactName"    = COALESCE("contactName",    v_contact_name),
      "signatureEvent" = COALESCE("signatureEvent", v_signature_event),
      "updatedAt"      = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("contactName" IS NULL OR "signatureEvent" IS NULL);
END $$;

-- ── #1672: Mooloo H3 — description rewrite (drop "men's") + null-fills ──
DO $$
DECLARE
  v_kennel_code         text := 'mooloo-h3';
  v_correct_description text := 'Fun and friendly Monday run or walk at 6 pm from Hamilton locations (roughly every 2nd Monday). Follow a trail at your own pace with us, then enjoy a meal and a free beer or wine! Plus much more — all for $10!';
  v_facebook_url        text := 'https://www.facebook.com/MoolooHHH';
  v_contact_email       text := 'c.thomsen@hotmail.co.nz';
  v_hash_cash           text := '$10 NZD (covers home meal + 1 drink; pay online or cash to ShakesBeer)';
  v_logo_url            text := '/kennel-logos/mooloo-h3.jpg';
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
  SET "facebookUrl"  = COALESCE("facebookUrl",  v_facebook_url),
      "contactEmail" = COALESCE("contactEmail", v_contact_email),
      "hashCash"     = COALESCE("hashCash",     v_hash_cash),
      "logoUrl"      = COALESCE("logoUrl",      v_logo_url),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "facebookUrl"  IS NULL
      OR "contactEmail" IS NULL
      OR "hashCash"     IS NULL
      OR "logoUrl"      IS NULL
    );
END $$;

-- ── #1675: Moooouston H3 — scheduleFrequency Monthly → Weekly + description rewrite + null-fills ──
DO $$
DECLARE
  v_kennel_code         text := 'moooouston-h3';
  v_correct_frequency   text := 'Weekly';
  v_correct_description text := 'Houston, TX kennel founded 2016. Backronym: Moving On On Over Optimal Urban Speeds ThRU Our Neighborhoods Hash House Harriers. Weekly Monday trails, typically 7:00 PM show / 7:30 PM go from rotating Houston-area trailheads.';
  v_founded             int  := 2016;
  v_schedule_day        text := 'Monday';
  v_schedule_time       text := '7:00 PM';
  v_schedule_notes      text := 'Weekly Mondays, 7:00 PM show / 7:30 PM go from a rotating Houston-area trailhead. Specific location announced per-event on the Houston Hash Calendar.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "scheduleFrequency" = v_correct_frequency,
      description         = v_correct_description,
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleFrequency" IS DISTINCT FROM v_correct_frequency
      OR description         IS DISTINCT FROM v_correct_description
    );

  UPDATE "Kennel"
  SET "foundedYear"       = COALESCE("foundedYear",       v_founded),
      "scheduleDayOfWeek" = COALESCE("scheduleDayOfWeek", v_schedule_day),
      "scheduleTime"      = COALESCE("scheduleTime",      v_schedule_time),
      "scheduleNotes"     = COALESCE("scheduleNotes",     v_schedule_notes),
      "updatedAt"         = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "foundedYear"       IS NULL
      OR "scheduleDayOfWeek" IS NULL
      OR "scheduleTime"      IS NULL
      OR "scheduleNotes"     IS NULL
    );
END $$;

-- ── #1700: Morgantown H3 — hashCash null-fill only ──
DO $$
DECLARE
  v_kennel_code         text := 'mh3-wv';
  v_hash_cash           text := '$5 USD';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "hashCash"  = COALESCE("hashCash", v_hash_cash),
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "hashCash" IS NULL;
END $$;

-- ── #1703: Mosquito H3 — description rewrite + hashCash null-fill ──
DO $$
DECLARE
  v_kennel_code         text := 'mosquito-h3';
  v_correct_description text := 'Mosquito H3 runs on the first and third Wednesdays of the month on the west side of Houston, with trails outside Beltway 8 typically 3-4 miles in length and including shiggy.';
  v_hash_cash           text := '$5 USD';
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
  SET "hashCash"  = COALESCE("hashCash", v_hash_cash),
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "hashCash" IS NULL;
END $$;

COMMIT;
