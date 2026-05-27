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
      ('cfh3',             'Runs on the 1st, 3rd, and 5th Saturday of each month in the Wilmington/Cape Fear area.')
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
-- #1438 — mosquito-h3 legacy flat fields: backfill scheduleDayOfWeek/Time
-- and correct scheduleFrequency ("Bimonthly" → "Biweekly") so the
-- fallback display matches the new scheduleRules. Direct assignment
-- (Gemini review on PR #1725) — these three fields are authoritative
-- once the kennel has been migrated to scheduleRules, so any stale
-- non-NULL values must be corrected too.
-- ──────────────────────────────────────────────────────────────────────────

UPDATE "Kennel"
SET "scheduleFrequency" = 'Biweekly',
    "scheduleDayOfWeek" = 'Wednesday',
    "scheduleTime"      = '6:30 PM',
    "updatedAt"         = NOW()
WHERE "kennelCode" = 'mosquito-h3'  -- NOSONAR plsql:S1192 — same kennel code reused in INSERT block below; deduplication would obscure the row's standalone purpose
  AND (
    "scheduleFrequency" IS DISTINCT FROM 'Biweekly'
    OR "scheduleDayOfWeek" IS DISTINCT FROM 'Wednesday'
    OR "scheduleTime"      IS DISTINCT FROM '6:30 PM'
  );

-- ──────────────────────────────────────────────────────────────────────────
-- #1438 — INSERT ScheduleRule rows for the two newly-migrated kennels.
--
-- Codex review on PR #1725: `runScheduleRuleBackfill` Pass 3 only fires
-- on `prisma db seed`, which Vercel's `vercel-build` (just
-- `prisma migrate deploy && next build`) does NOT run. Without these
-- INSERTs, prod Travel Mode + kennel pages would keep showing the
-- old Pass-2 rules until someone manually re-seeded.
--
-- Mirrors the lbh3/mgh4 inline-insert pattern from migration
-- 20260525130000_add_lbh3_mgh4_schedule_rules. Idempotent via
-- deterministic IDs + ON CONFLICT; `runScheduleRuleBackfill` will
-- find the same (kennelId, rrule, source) keys on the next seed and
-- ON CONFLICT will absorb without churn.
-- ──────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_missing text[];
BEGIN
  SELECT ARRAY_AGG(c) INTO v_missing
  FROM unnest(ARRAY['mosquito-h3', 'cfh3']) AS c  -- NOSONAR plsql:S1192 — kennel codes reused in the INSERT VALUES below; data-row duplication
  WHERE NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = c);  -- NOSONAR plsql:S1138
  IF v_missing IS NOT NULL THEN
    RAISE NOTICE 'Kennels not found: % — ScheduleRule INSERT will no-op for them (run prisma db seed)', v_missing;  -- NOSONAR plsql:S1192
  END IF;
END $$;

INSERT INTO "ScheduleRule" (
  id, "kennelId", rrule, "startTime", confidence, source,
  "sourceReference", "lastValidatedAt", "isActive", label,
  "validFrom", "validUntil", "displayOrder", "createdAt", "updatedAt"
)
SELECT
  v.id,
  k.id,
  v.rrule,
  v.start_time,
  'HIGH'::"ScheduleConfidence",
  'SEED_DATA'::"ScheduleRuleSource",
  v.source_ref,
  NOW(),
  true,
  NULL,
  NULL,
  NULL,
  v.display_order,
  NOW(),
  NOW()
FROM (
  -- VALUES rows duplicate kennel_code / start_time / source_ref by design — each
  -- row maps one ScheduleRule. SonarCloud plsql:S1192 suppressed per-line.
  VALUES
    -- mosquito-h3 — 1st & 3rd Wednesday at 6:30 PM (mirror of larrikins).
    ('mig_1438_mosquito_1we', 'mosquito-h3', 'FREQ=MONTHLY;BYDAY=1WE', '18:30', 0, 'KennelSeed.scheduleRules[mosquito-h3]'),  -- NOSONAR plsql:S1192
    ('mig_1438_mosquito_3we', 'mosquito-h3', 'FREQ=MONTHLY;BYDAY=3WE', '18:30', 1, 'KennelSeed.scheduleRules[mosquito-h3]'),  -- NOSONAR plsql:S1192
    -- cfh3 — 1st, 3rd, 5th Saturday at 2:00 PM.
    ('mig_1438_cfh3_1sa',     'cfh3',        'FREQ=MONTHLY;BYDAY=1SA', '14:00', 0, 'KennelSeed.scheduleRules[cfh3]'),  -- NOSONAR plsql:S1192
    ('mig_1438_cfh3_3sa',     'cfh3',        'FREQ=MONTHLY;BYDAY=3SA', '14:00', 1, 'KennelSeed.scheduleRules[cfh3]'),  -- NOSONAR plsql:S1192
    ('mig_1438_cfh3_5sa',     'cfh3',        'FREQ=MONTHLY;BYDAY=5SA', '14:00', 2, 'KennelSeed.scheduleRules[cfh3]')   -- NOSONAR plsql:S1192
) AS v(id, kennel_code, rrule, start_time, display_order, source_ref)
JOIN "Kennel" k ON k."kennelCode" = v.kennel_code
ON CONFLICT ("kennelId", rrule, source) DO UPDATE SET
  "startTime"       = EXCLUDED."startTime",
  confidence        = EXCLUDED.confidence,
  "sourceReference" = EXCLUDED."sourceReference",
  "lastValidatedAt" = EXCLUDED."lastValidatedAt",
  "isActive"        = true,
  "displayOrder"    = EXCLUDED."displayOrder",
  "updatedAt"       = NOW();

COMMIT;
