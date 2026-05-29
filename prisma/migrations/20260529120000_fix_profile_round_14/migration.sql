-- Profile Round 14 quick-win bundle (#1715, #1732, #1756, #1760, #1762, #1777,
-- #1778, #1751, #1754) — converge prod kennel fields with the refreshed seed data
-- in prisma/seed-data/kennels.ts.
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows — it never
-- overwrites populated ones. Several rewrites here change non-NULL prod values
-- (n2th3 scheduleTime + description, nbh3-wa description, nose-h3 description,
-- melbourne-bike-hash scheduleFrequency + description + scheduleNotes,
-- melbourne-city-h3 description + scheduleNotes), and a plain seed change
-- wouldn't reach end users without these UPDATEs.
--
-- The null-only fills (socials, contact, hashCash, foundedYear, logoUrl,
-- scheduleNotes/scheduleTime where prod is still NULL) are also issued here via
-- COALESCE so Vercel's automatic `migrate deploy` pushes them to prod without
-- waiting for the next manual `prisma db seed` (see memory:
-- feedback_post_merge_seed_required.md).
--
-- nbh3 (Northboro) hashCash ($7) and description are NOT touched here: prod
-- already carries the correct $7 value and the richer description, so only the
-- seed is corrected (stale $30 → $7) for fresh-DB convergence — the null-fills
-- below (contactEmail, scheduleNotes, logoUrl) are the only prod-reaching changes.
--
-- Idempotency: `IS DISTINCT FROM` gates make re-application a no-op on an
-- already-corrected DB. A NOTICE surfaces missing-row situations on fresh /
-- preview DBs.

BEGIN;

-- ── #1715: N2H3 (No Name H3, Portland) — socials + contact null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'n2h3';
  v_facebook    text := 'https://www.facebook.com/nonameh3.onon/';
  v_instagram   text := 'no_name_hash';
  v_twitter     text := 'NoNameH3_OnOn';
  v_email       text := 'NoNameH3.OnOn@gmail.com';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "facebookUrl"     = COALESCE("facebookUrl",     v_facebook),
      "instagramHandle" = COALESCE("instagramHandle", v_instagram),
      "twitterHandle"   = COALESCE("twitterHandle",   v_twitter),
      "contactEmail"    = COALESCE("contactEmail",    v_email),
      "updatedAt"       = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "facebookUrl"     IS NULL
      OR "instagramHandle" IS NULL
      OR "twitterHandle"   IS NULL
      OR "contactEmail"    IS NULL
    );
END $$;

-- ── #1732: N2TH3 (Hong Kong) — scheduleTime 7:00 → 7:30 PM + description rewrite + null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'n2th3';
  v_sched_time      text := '7:30 PM';
  v_old_display_time text := '7:00 PM';
  v_description text := 'Hong Kong''s Northern New Territories hash. Weekly Wednesday evening runs with 2200+ trails since founding. Blog-based trail announcements with full run details. Hash cash is HK$60 per run (HK$40 for the fairer sex); first run free.';
  v_old_desc    text := 'Hong Kong''s Northern New Territories hash. Weekly Wednesday evening runs with 2200+ trails since founding. Blog-based trail announcements with full run details.';
  v_email       text := 'gunpowderplod@gmail.com';
  v_contact     text := 'Gunpowder Plod';
  v_sched_notes text := 'Also a Saturday afternoon run every couple of months.';
  v_hash_cash   text := 'HK$60';
  v_founded     int  := 1974;
  v_logo        text := 'https://n2th3.org/wp-content/uploads/2020/02/cropped-pacman-icon.jpg?w=200';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- Overrides gated on the exact known-stale value so a later misman edit is never clobbered.
  UPDATE "Kennel"
  SET "scheduleTime" = v_sched_time, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND "scheduleTime" = v_old_display_time;

  UPDATE "Kennel"
  SET description = v_description, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND description = v_old_desc;

  UPDATE "Kennel"
  SET "contactEmail"  = COALESCE("contactEmail",  v_email),
      "contactName"   = COALESCE("contactName",   v_contact),
      "scheduleNotes" = COALESCE("scheduleNotes", v_sched_notes),
      "hashCash"      = COALESCE("hashCash",      v_hash_cash),
      "foundedYear"   = COALESCE("foundedYear",   v_founded),
      "logoUrl"       = COALESCE("logoUrl",       v_logo),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "contactEmail"  IS NULL
      OR "contactName"   IS NULL
      OR "scheduleNotes" IS NULL
      OR "hashCash"      IS NULL
      OR "foundedYear"   IS NULL
      OR "logoUrl"       IS NULL
    );
END $$;

-- ── #1732 (cont.): N2TH3 static-schedule time 19:00 → 19:30 so generated events
--    and Travel projections match the corrected 7:30 PM profile. Four surfaces are
--    converged together so prod stays consistent under Vercel's `migrate deploy`
--    (which does not run `prisma db seed`):
--      1. Source.config.startTime  — without this the next daily STATIC_SCHEDULE
--         scrape would regenerate future events back at 19:00.
--      2. ScheduleRule.startTime    — drives hareline projections + Travel Mode.
--      3. Event.startTime           — the upcoming rows already generated at 19:00.
--      4. Event.dateUtc             — recomputed from the kennel TZ so the UTC anchor
--         the UI formats from agrees with the new local time (19:30 HKT = 11:30 UTC).
--    sources.ts is updated in lockstep so re-seeds stay at 19:30. Every UPDATE is
--    gated on the exact stale 19:00 value: idempotent, and a hand-edited time is
--    never clobbered. Past events keep their recorded times (date >= CURRENT_DATE). ──
DO $$
DECLARE
  v_kennel_code  text := 'n2th3';
  v_source_name  text := 'N2TH3 Static Schedule';
  v_old_24h_time text := '19:00';
  v_new_time     text := '19:30';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "Source" WHERE name = v_source_name AND type = 'STATIC_SCHEDULE') THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Source "%" not found — config UPDATE will no-op (run prisma db seed)', v_source_name;  -- NOSONAR plsql:S1192
  END IF;

  -- 1. Persisted static-schedule source config. `ensureSources` (prisma/seed.ts) also
  --    syncs Source.config from sources.ts on the next `db seed`, but Vercel only runs
  --    `migrate deploy` — so this UPDATE closes the window where a daily scrape would
  --    otherwise regenerate future events back at 19:00 before a manual seed.
  UPDATE "Source"
  SET config = jsonb_set(config, '{startTime}', to_jsonb(v_new_time), true),
      "updatedAt" = NOW()
  WHERE name = v_source_name
    AND type = 'STATIC_SCHEDULE'
    AND config->>'startTime' = v_old_24h_time;

  -- 2. Active + inactive ScheduleRule rows for this kennel (drive hareline projections + Travel Mode).
  UPDATE "ScheduleRule" sr
  SET "startTime" = v_new_time, "updatedAt" = NOW()
  FROM "Kennel" k
  WHERE sr."kennelId" = k.id
    AND k."kennelCode" = v_kennel_code
    AND sr."startTime" = v_old_24h_time;

  -- 3 + 4. Upcoming events already generated at 19:00 — retime AND recompute the UTC anchor
  --        atomically so startTime, dateUtc, and timezone stay in agreement.
  UPDATE "Event" e
  SET "startTime" = v_new_time,
      "dateUtc"   = ((e.date::date + v_new_time::time) AT TIME ZONE COALESCE(e.timezone, 'Asia/Hong_Kong')) AT TIME ZONE 'UTC',
      "updatedAt" = NOW()
  FROM "Kennel" k
  WHERE e."kennelId" = k.id
    AND k."kennelCode" = v_kennel_code
    AND e."startTime" = v_old_24h_time
    AND e.date >= CURRENT_DATE;
END $$;

-- ── #1756: NbH3 (Northboro) — contact/scheduleNotes/logo null-fills only (hashCash + description already correct in prod) ──
DO $$
DECLARE
  v_kennel_code text := 'nbh3';
  v_email       text := 'hareraisernh3@gmail.com';
  v_sched_notes text := 'Trails usually start between noon and 1pm on weekends.';
  v_logo        text := '/kennel-logos/nbh3.jpg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "contactEmail"  = COALESCE("contactEmail",  v_email),
      "scheduleNotes" = COALESCE("scheduleNotes", v_sched_notes),
      "logoUrl"       = COALESCE("logoUrl",       v_logo),
      "updatedAt"     = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "contactEmail"  IS NULL
      OR "scheduleNotes" IS NULL
      OR "logoUrl"       IS NULL
    );
END $$;

-- ── #1760: NBH3 (No Balls H3, Seattle) — description rewrite + contact/logo null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'nbh3-wa';
  v_description text := 'All-women''s Seattle kennel founded 1989 by Captain Crash and Slo Mo. Low-key hashing on the last Wednesday night of each month — fun, wine, and booze.';
  v_old_desc    text := 'Women''s hash in Seattle. Last Wednesday of the month at 6:30pm. Founded 1989.';
  v_email       text := 'NoBallsH3@gmail.com';
  v_logo        text := 'https://wh3.org/img/icons/NBH3.png';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- Override gated on the exact known-stale value so a later misman edit is never clobbered.
  UPDATE "Kennel"
  SET description = v_description,
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND description = v_old_desc;

  UPDATE "Kennel"
  SET "contactEmail" = COALESCE("contactEmail", v_email),
      "logoUrl"      = COALESCE("logoUrl",      v_logo),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND ("contactEmail" IS NULL OR "logoUrl" IS NULL);
END $$;

-- ── #1762: NCH3 (North County, San Diego) — website + logo null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'nch3-sd';
  v_website     text := 'https://nch3.com/';
  v_logo        text := 'https://sdh3.com/site_images/nch3-thm.gif';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET website     = COALESCE(website,   v_website),
      "logoUrl"   = COALESCE("logoUrl", v_logo),
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (website IS NULL OR "logoUrl" IS NULL);
END $$;

-- ── #1777: Norfolk H3 (UK) — social/contact/hashCash/founded/misman/logo null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'norfolkh3';
  v_instagram   text := 'norfolkh3';
  v_mailing     text := 'https://groups.google.com/g/norfolkhhh';
  v_email       text := 'norfolkhhh+subscribe@googlegroups.com';
  v_hash_cash   text := '£2.50 after first run';
  v_founded     int  := 1984;
  v_gm          text := 'Lobotomy';
  v_hare_raiser text := 'Woolly Jumper';
  v_logo        text := 'https://norfolkh3.co.uk/wp-content/uploads/2024/07/foot-removebg-preview.png?w=500';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  UPDATE "Kennel"
  SET "instagramHandle" = COALESCE("instagramHandle", v_instagram),
      "mailingListUrl"  = COALESCE("mailingListUrl",  v_mailing),
      "contactEmail"    = COALESCE("contactEmail",    v_email),
      "hashCash"        = COALESCE("hashCash",        v_hash_cash),
      "foundedYear"     = COALESCE("foundedYear",     v_founded),
      gm                = COALESCE(gm,                v_gm),
      "hareRaiser"      = COALESCE("hareRaiser",      v_hare_raiser),
      "logoUrl"         = COALESCE("logoUrl",         v_logo),
      "updatedAt"       = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "instagramHandle" IS NULL
      OR "mailingListUrl" IS NULL
      OR "contactEmail"   IS NULL
      OR "hashCash"       IS NULL
      OR "foundedYear"    IS NULL
      OR gm               IS NULL
      OR "hareRaiser"     IS NULL
      OR "logoUrl"        IS NULL
    );
END $$;

-- ── #1778: NOSE H3 (North NJ) — founded null-fill + description rewrite (founder/hotline) ──
DO $$
DECLARE
  v_kennel_code text := 'nose-h3';
  v_founded     int  := 2014;
  v_description text := 'Active weekly kennel in North NJ (north of I-78). Runs flip from Thursdays in summer to Wednesdays in winter. Founded in 2014 by Twatever; parented by Rome H3. Hotline: 973.627.2575.';
  v_old_desc    text := 'Active weekly kennel in North NJ (north of I-78). Runs flip from Thursdays in summer to Wednesdays in winter.';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- Override gated on the exact known-stale value so a later misman edit is never clobbered.
  UPDATE "Kennel"
  SET description = v_description,
      "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND description = v_old_desc;

  UPDATE "Kennel"
  SET "foundedYear" = COALESCE("foundedYear", v_founded),
      "updatedAt"   = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND "foundedYear" IS NULL;
END $$;

-- ── #1751: Melbourne Bike Hash — scheduleFrequency Weekly → Monthly + description/notes rewrite + null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'melbourne-bike-hash';
  v_frequency   text := 'Monthly';
  v_old_freq    text := 'Weekly';
  v_description text := 'Melbourne''s bike hash — a drinking group with a cycling problem, running monthly social bike-hash rides around greater Melbourne. Hash cash is $5 for the ride and drinks.';
  v_old_desc    text := 'Melbourne Bike Hash — a bike-hash variant operating in the Melbourne New Moon ecosystem. Publishes through the melbourne-new-moon-running-group Meetup. Profile is a stub pending full research.';
  v_sched_notes text := 'Monthly cycle rides around greater Melbourne; ride details posted on the Facebook group.';
  v_old_notes   text := 'Cycling sub-group that publishes via the melbourne-new-moon-running-group Meetup aggregator. Stub pending full research.';
  v_website     text := 'https://sites.google.com/view/melbournebikehhh/home';
  v_facebook    text := 'https://www.facebook.com/groups/Melbournebikehash/';
  v_email       text := 'melbournebikehhh@gmail.com';
  v_hash_cash   text := '$5';
  v_logo        text := '/kennel-logos/melbourne-bike-hash.jpg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- Overrides (de-stub) gated on the exact known-stale value so a later misman edit is never clobbered.
  UPDATE "Kennel"
  SET "scheduleFrequency" = v_frequency, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND "scheduleFrequency" = v_old_freq;

  UPDATE "Kennel"
  SET description = v_description, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND description = v_old_desc;

  UPDATE "Kennel"
  SET "scheduleNotes" = v_sched_notes, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND "scheduleNotes" = v_old_notes;

  UPDATE "Kennel"
  SET website        = COALESCE(website,        v_website),
      "facebookUrl"  = COALESCE("facebookUrl",  v_facebook),
      "contactEmail" = COALESCE("contactEmail", v_email),
      "hashCash"     = COALESCE("hashCash",     v_hash_cash),
      "logoUrl"      = COALESCE("logoUrl",      v_logo),
      "updatedAt"    = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      website        IS NULL
      OR "facebookUrl"  IS NULL
      OR "contactEmail" IS NULL
      OR "hashCash"     IS NULL
      OR "logoUrl"      IS NULL
    );
END $$;

-- ── #1754: Melbourne City H3 — description/notes rewrite + schedule/social/contact/logo null-fills ──
DO $$
DECLARE
  v_kennel_code text := 'melbourne-city-h3';
  v_description text := 'Melbourne City Hash House Harriers run for fun and post-run socialising, with public-transport-friendly trails within 10km of the Melbourne CBD.';
  v_old_desc    text := 'Melbourne City H3 — sister kennel to Melbourne New Moon. Publishes through the melbourne-new-moon-running-group Meetup aggregator. Profile is a stub pending full research.';
  v_sched_notes text := '6pm every Thursday — 1st and 3rd Thursdays are hash trails, other Thursdays are 5km beer runs.';
  v_old_notes   text := 'Twice a month on Thursdays, within 10km of the Melbourne CBD (per Mel-NM Meetup About). Stub pending full research.';
  v_sched_time  text := '6:00 PM';
  v_facebook    text := 'https://www.facebook.com/melctyhhh';
  v_instagram   text := 'melctyhhh';
  v_twitter     text := 'MelCtyHHH';
  v_email       text := 'MELCTYHHH@hotmail.com';
  v_logo        text := '/kennel-logos/melbourne-city-h3.jpg';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = v_kennel_code) THEN  -- NOSONAR plsql:S1138
    RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', v_kennel_code;  -- NOSONAR plsql:S1192
  END IF;

  -- Overrides (de-stub) gated on the exact known-stale value so a later misman edit is never clobbered.
  UPDATE "Kennel"
  SET description = v_description, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND description = v_old_desc;

  UPDATE "Kennel"
  SET "scheduleNotes" = v_sched_notes, "updatedAt" = NOW()
  WHERE "kennelCode" = v_kennel_code AND "scheduleNotes" = v_old_notes;

  UPDATE "Kennel"
  SET "scheduleTime"    = COALESCE("scheduleTime",    v_sched_time),
      "facebookUrl"     = COALESCE("facebookUrl",     v_facebook),
      "instagramHandle" = COALESCE("instagramHandle", v_instagram),
      "twitterHandle"   = COALESCE("twitterHandle",   v_twitter),
      "contactEmail"    = COALESCE("contactEmail",    v_email),
      "logoUrl"         = COALESCE("logoUrl",         v_logo),
      "updatedAt"       = NOW()
  WHERE "kennelCode" = v_kennel_code
    AND (
      "scheduleTime"    IS NULL
      OR "facebookUrl"     IS NULL
      OR "instagramHandle" IS NULL
      OR "twitterHandle"   IS NULL
      OR "contactEmail"    IS NULL
      OR "logoUrl"         IS NULL
    );
END $$;

COMMIT;
