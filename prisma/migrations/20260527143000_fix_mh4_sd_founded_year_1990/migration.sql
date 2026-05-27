-- Follow-up to 20260526120000_fix_profile_round_13 (PR #1722 Codex P2).
--
-- The original migration was authored with v_founded=1991 (derived from the
-- issue's "35th Analvesary Turnover 2026" math). Codex review on PR #1722
-- pointed out the canonical source is sdh3.com history: "San Diego Mission
-- Harriettes Established Nov 10, 1990". A subsequent fix commit on the same
-- PR rewrote 20260526120000's SQL to v_founded=1990, but by that point the
-- PR's preview deployment had already run `prisma migrate deploy` against
-- prod (Vercel's vercel-build does this on every deploy, preview included)
-- and applied the 1991 version. Editing an already-applied migration file
-- can't reach prod — Prisma `migrate deploy` is keyed on migration_name and
-- only runs each migration once.
--
-- This migration ships the 1990 correction as a forward fix per the
-- "migrations are immutable once applied" rule in CLAUDE.md. Idempotent via
-- `IS DISTINCT FROM` so re-application is a no-op.

BEGIN;

DO $$
DECLARE
  v_kennel_code         text := 'mh4-sd';
  v_correct_founded     int  := 1990;
  v_correct_description text := 'Mission Harriettes — San Diego''s women-only monthly hash, founded November 10, 1990 (per sdh3.com history). Wednesdays once a month, 6:30 PM start.';
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
END $$;

COMMIT;
