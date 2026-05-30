-- Profile Round 15 hash-cash backfill (#1504, #1571) — drain prose-captured
-- hash cash values into the structured `Kennel.hashCash` slot.
--
-- The cycle-15 canonical decision (#1571) keeps `Kennel.hashCash` (kennel-level
-- standard/headline) and `Event.cost` (per-event override) as a two-tier model —
-- no schema change. This migration only backfills DATA. The matching seed
-- headline values live in prisma/seed-data/kennels.ts; the prose detail stays in
-- each kennel's `description` (carries tier / payment-method nuance the headline
-- can't encode, e.g. "non piss-stop vs piss-stop", "pay-as-you-go at restaurants").
--
-- Why a migration and not just a seed update: `ensureKennelRecords`
-- (prisma/seed.ts) only fills NULL profile fields on existing rows, and Vercel's
-- build runs `migrate deploy` — not `prisma db seed`. Issuing the null-fills via
-- COALESCE here pushes them to prod automatically (see memory:
-- feedback_post_merge_seed_required.md). All 14 candidate slots were verified
-- NULL in prod before authoring; motherh3 / mrhappy / mrh3 were already populated
-- and are intentionally excluded.
--
-- Idempotency: COALESCE + `"hashCash" IS NULL` guard makes re-application a no-op
-- on an already-corrected DB. A NOTICE surfaces missing-row situations on fresh /
-- preview DBs.

BEGIN;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('garden-city-h3',   '$7 (at hare''s home)'),
      ('capital-h3-nz',    '$2'),
      ('geriatrix-h3',     '$2 / $4'),
      ('auckland-hussies', '$15'),
      ('hibiscus-h3',      'Free'),
      ('mel-new-moon',     '$5'),
      ('lbh-phx',          '$5'),
      ('lds-h3',           '$5'),
      ('lil',              '$20'),
      ('lch3',             '$15 ladies / $20 men'),
      ('madisonh3',        '$5')
    ) AS t(kennel_code, hash_cash)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = r.kennel_code) THEN  -- NOSONAR plsql:S1138
      RAISE NOTICE 'Kennel "%" not found — UPDATE will no-op (run prisma db seed)', r.kennel_code;  -- NOSONAR plsql:S1192
    END IF;

    UPDATE "Kennel"
    SET "hashCash"  = COALESCE("hashCash", r.hash_cash),
        "updatedAt" = NOW()
    WHERE "kennelCode" = r.kennel_code
      AND "hashCash" IS NULL;
  END LOOP;
END $$;

COMMIT;
