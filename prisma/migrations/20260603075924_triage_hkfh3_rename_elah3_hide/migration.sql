-- Dead/stale-source triage (#1373/#1374 HKFH3, #1358 Hebe, #1130 ELAH3,
-- #1144/#1459 VTH3).
--
-- The seed files (prisma/seed-data/{kennels,sources,aliases}.ts) carry the
-- same corrections so fresh DBs land identical data, but Vercel runs only
-- `prisma migrate deploy` (never `prisma db seed`). Without this migration the
-- only path to prod would be a manual seed — so the live `Source`/`Kennel`
-- rows are converged here. Structure + idioms mirror
-- 20260521020000_fix_se_asia_static_schedules (per-area DO block, NOTICE-not-
-- RAISE on missing seed rows so a pre-seed deploy doesn't abort, `IS DISTINCT
-- FROM` divergence guards + `COALESCE` so re-runs and admin edits are no-ops).
--
-- Two changes the seed genuinely cannot make on existing rows and that only
-- this migration can apply:
--   * Kennel.fullName — seed deliberately never updates fullName on existing
--     rows (admin-curation guard, prisma/seed.ts).
--   * Kennel.isHidden — not a seed PROFILE_FIELD; seed never writes it.
--
-- VTH3's stale "Future VTH3 Run" placeholder EVENTS are intentionally NOT
-- deleted here — that cleanup ships as the post-merge one-shot
-- scripts/cleanup-vth3-meetup-placeholders.ts (provenance-scoped, dry-run
-- first). This migration only flips the dead Meetup source off so it stops
-- generating new placeholders on the next scrape.

BEGIN;

-- ===== HKFH3 (#1373 / #1374): "Full House" → "Hong Kong Friday Hash" =====
DO $$
DECLARE
  v_kennel_code  text := 'hkfh3';
  v_source_name  text := 'HKFH3 Static Schedule';
  v_source_type  text := 'STATIC_SCHEDULE';
  v_old_fullname text := 'Hong Kong Full House Hash House Harriers';
  v_new_fullname text := 'Hong Kong Friday Hash House Harriers';
  v_new_url      text := 'https://www.facebook.com/groups/197105523127/';
  v_new_descr    text := 'Monthly Friday evening trail. Check the HK Friday Hash Facebook group for run details and start location.';
  v_facebook_url text := 'https://www.facebook.com/groups/197105523127/';
  v_contact      text := 'HKFridayHash@gmail.com';
  v_founder      text := 'Stash & Hopeless';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN
    RAISE NOTICE 'Kennel "%" not found — updates will no-op (run prisma db seed)', v_kennel_code;
  END IF;

  -- Correct the long name only if still on the audited stale value (admin
  -- curation to anything else is preserved).
  UPDATE "Kennel"
  SET "fullName" = v_new_fullname,
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE "kennelCode" = v_kennel_code
    AND "fullName" = v_old_fullname;

  -- Fill recoverable profile fields when still NULL (don't stomp admin edits).
  UPDATE "Kennel"
  SET "facebookUrl" = COALESCE("facebookUrl", v_facebook_url),
      "contactEmail" = COALESCE("contactEmail", v_contact),
      founder = COALESCE(founder, v_founder),
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE "kennelCode" = v_kennel_code
    AND ("facebookUrl" IS NULL OR "contactEmail" IS NULL OR founder IS NULL);

  -- Repoint the dead source URL + drop the "cadence uncertain" caveat.
  UPDATE "Source"
  SET url = v_new_url,
      config = COALESCE(config, '{}'::jsonb) || jsonb_build_object('defaultDescription', v_new_descr),
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND (url IS DISTINCT FROM v_new_url OR config->>'defaultDescription' IS DISTINCT FROM v_new_descr);
END $$;

-- ===== Hebe H3 (#1358): dead Page handle → real FB group =====
DO $$
DECLARE
  v_source_name text := 'Hebe H3 Static Schedule';
  v_source_type text := 'STATIC_SCHEDULE';
  v_new_url     text := 'https://www.facebook.com/groups/HebeH3';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type) THEN
    RAISE NOTICE 'Source "%" not found — UPDATE will no-op (run prisma db seed)', v_source_name;
  END IF;

  UPDATE "Source"
  SET url = v_new_url,
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND url IS DISTINCT FROM v_new_url;
END $$;

-- ===== ELAH3 (#1130): defunct/mis-registered — hide kennel + disable source =====
DO $$
DECLARE
  v_kennel_code text := 'elah3';
  v_source_name text := 'East LA H3 Google Calendar';
  v_source_type text := 'GOOGLE_CALENDAR';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN
    RAISE NOTICE 'Kennel "%" not found — update will no-op (run prisma db seed)', v_kennel_code;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type) THEN
    RAISE NOTICE 'Source "%" not found — update will no-op (run prisma db seed)', v_source_name;
  END IF;

  -- Hide the kennel from the public directory + hareline (the only "source" is
  -- one ex-member's personal travel calendar; no third-party trace exists).
  UPDATE "Kennel"
  SET "isHidden" = true,
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE "kennelCode" = v_kennel_code
    AND "isHidden" = false;

  -- Disable the source so we stop ingesting the personal-travel events.
  UPDATE "Source"
  SET enabled = false,
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND enabled = true;
END $$;

-- ===== VTH3 (#1144 / #1459): disable dead Meetup source =====
DO $$
DECLARE
  v_source_name text := 'Von Tramp H3 Meetup';
  v_source_type text := 'MEETUP';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Source" WHERE name = v_source_name AND type::text = v_source_type) THEN
    RAISE NOTICE 'Source "%" not found — update will no-op (run prisma db seed)', v_source_name;
  END IF;

  -- Meetup group is gone ("Group not found"); disable so it stops generating
  -- "Future VTH3 Run" placeholders. Existing placeholder events are removed
  -- post-merge via scripts/cleanup-vth3-meetup-placeholders.ts. The FB Hosted
  -- Events source for VTH3 stays enabled.
  UPDATE "Source"
  SET enabled = false,
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE name = v_source_name
    AND type::text = v_source_type
    AND enabled = true;
END $$;

-- Verify post-state. EXISTS predicates rather than SELECT...INTO: they no-op
-- cleanly on a pre-seed DB (row absent) and don't assume a single matching row
-- (Source is @@unique([name,type]) and kennelCode is unique, so a match is
-- always ≤1, but EXISTS is the idiomatic shape for a "should be no rows left in
-- the bad state" assertion).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'hkfh3' AND "fullName" = 'Hong Kong Full House Hash House Harriers'
  ) THEN
    RAISE EXCEPTION 'hkfh3 fullName still has the stale "Full House" value after migration';
  END IF;

  IF EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = 'elah3' AND "isHidden" = false) THEN
    RAISE EXCEPTION 'elah3 isHidden is not true after migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Source" WHERE name = 'East LA H3 Google Calendar' AND type::text = 'GOOGLE_CALENDAR' AND enabled = true
  ) THEN
    RAISE EXCEPTION 'ELAH3 Google Calendar source is still enabled after migration';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Source" WHERE name = 'Von Tramp H3 Meetup' AND type::text = 'MEETUP' AND enabled = true
  ) THEN
    RAISE EXCEPTION 'VTH3 Meetup source is still enabled after migration';
  END IF;
END $$;

COMMIT;
