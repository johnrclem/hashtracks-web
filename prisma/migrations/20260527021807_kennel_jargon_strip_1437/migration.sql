-- #1437 — Kennel description / scheduleNotes jargon strip.
--
-- 19 user-facing kennel rows had platform/CMS jargon leaking into the copy
-- shown on profile cards and directory listings ("Wix-hosted hareline",
-- "TablePress at ...", "DataTables grid", "Active Meetup group with X
-- members", "Check Facebook for ...", "static HTML table", etc.).
-- Rewrites land in prisma/seed-data/kennels.ts and must reach prod via
-- this migration because `ensureKennelRecords` (prisma/seed.ts) only fills
-- NULL profile fields on existing rows — it never overwrites populated
-- ones. See memory: feedback_no_internal_data_in_copy.md +
-- feedback_seed_fill_coverage_check.md.
--
-- Each block gates on IS DISTINCT FROM so re-application is a no-op on an
-- already-corrected DB. A NOTICE surfaces missing-row situations on
-- fresh / preview DBs (the next `prisma db seed` will create them).

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- Description rewrites
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('nose-h3',          'Active weekly kennel in North NJ (north of I-78). Runs flip from Thursdays in summer to Wednesdays in winter.'),
      ('sfh3',             'The flagship Bay Area kennel (est. 1982). Weekly Monday evening runs in San Francisco. Hosts the sfh3.com Bay Area kennel directory.'),
      ('lbh3',             'Founded January 6, 1985 by Dal "Jock" Trader, Jerry "Eject" Templeman, and Andy "Zapata" Limon. Runs Thursday evening during Spring/Summer and Sunday morning in the Fall/Winter, often with 50+ attendance. Visitors and virgins always welcome. Also hosts the Southern California kennel directory at lbh3.org/socal.'),
      ('sdh3',             'San Diego''s flagship kennel. Hosts the sdh3.com directory covering 15+ San Diego area kennels.'),
      ('lvh3',             'Monthly hash in the Allentown/Bethlehem/Easton area.'),
      ('sh3-wa',           'Seattle''s flagship kennel. Founded 1983. Hosts wh3.org — the regional schedule for Puget Sound area hashes.'),
      ('rch3',             'Akron''s hash kennel with a 1,000+ member community. Also runs summer Thursday evening trails.'),
      ('lh4-hk',           'Hong Kong''s ladies hash. Weekly Tuesday evening runs with a published hareline showing dates, hares, locations, and on-on venues.'),
      ('tokoroa-h3',       'Founded 1983, restarted 2009 — Waikato''s Tokoroa hash. Seasonal schedule: Wednesday evenings in summer, Sunday afternoons in winter. Trail announcements posted on Facebook.'),
      ('mooloo-h3',        'Hamilton/Waikato men''s hash. Trail starts shifted to 6:00 PM year-round; runs posted on the kennel website.')
    ) AS x("kennelCode", new_description)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = r."kennelCode") THEN
      RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', r."kennelCode";  -- NOSONAR plsql:S1192
    END IF;

    UPDATE "Kennel"
    SET description = r.new_description,
        "updatedAt" = NOW()
    WHERE "kennelCode" = r."kennelCode"
      AND description IS DISTINCT FROM r.new_description;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- scheduleNotes rewrites
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('mia-h3',           'Mostly Thursdays, with occasional special weekend events.'),
      ('dsh3-atl',         'New moon schedule — dates posted on Facebook.'),
      ('sh3-au',           'Weekly Tuesday hash around the Sydney metro. Often called ''Posh Hash'' — Sydney''s senior mixed kennel, founded 1967. Trail list posted at sh3.link.'),
      ('gch3-au',          'Weekly hash around the Gold Coast. Trail list posted on goldcoasthash.org/hareline.'),
      ('larrikins-au',     'Weekly Tuesday Larrikin Run. Trail list posted on sydney.larrikins.org.'),
      ('sth3-au',          'Weekly Thursday hash around inner Sydney. Trail list posted on sth3.org/upcoming-runs.'),
      ('bkk-h3',           'Weekly Saturday runs. Men only.'),
      ('hibiscus-h3',      'Weekly Monday evenings at 6:30 PM on Auckland''s Hibiscus Coast (Orewa). Trail list posted as a public schedule.'),
      ('auckland-hussies', 'Weekly Tuesday evenings at 6:30 PM. Run list posted on aucklandhussies.co.nz.')
    ) AS x("kennelCode", new_notes)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = r."kennelCode") THEN
      RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', r."kennelCode";  -- NOSONAR plsql:S1192
    END IF;

    UPDATE "Kennel"
    SET "scheduleNotes" = r.new_notes,
        "updatedAt"     = NOW()
    WHERE "kennelCode" = r."kennelCode"
      AND "scheduleNotes" IS DISTINCT FROM r.new_notes;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- #1438 — mosquito-h3 also gets scheduleDayOfWeek/scheduleTime backfill +
-- scheduleFrequency correction ("Bimonthly" → "Biweekly") so the legacy
-- flat-field fallback matches its new scheduleRules (added in seed data).
-- ──────────────────────────────────────────────────────────────────────────

UPDATE "Kennel"
SET "scheduleFrequency" = 'Biweekly',
    "scheduleDayOfWeek" = COALESCE("scheduleDayOfWeek", 'Wednesday'),
    "scheduleTime"      = COALESCE("scheduleTime",      '6:30 PM'),
    "updatedAt"         = NOW()
WHERE "kennelCode" = 'mosquito-h3'
  AND (
    "scheduleFrequency" IS DISTINCT FROM 'Biweekly'
    OR "scheduleDayOfWeek" IS NULL
    OR "scheduleTime"      IS NULL
  );

COMMIT;
