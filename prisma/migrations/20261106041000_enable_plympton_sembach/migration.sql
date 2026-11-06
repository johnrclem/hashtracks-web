-- Enable the two config-only sources shipped disabled by 20261106040000, after a
-- read-only prod dry-run of each adapter (2026-11-06):
--   Plympton H3 Google Calendar (#2594): 508 events 2022-10 → 2027-11, 263 plympton-h3 /
--     245 titsh3, 0 unrouted, 0 errors; ~240 dates new to prod, none within ±3 days of an
--     existing run. 47 bare "TBC" placeholder titles get a `^TBC$` titleStripPattern so they
--     become empty, like the 41 untitled slots, and merge synthesizes the kennel title.
--   Sembach H3 Hare Line Sheet (#2603): 45 rows 2026-01-10 → 2026-12-26, 0 errors;
--     24 dates new to prod (full-moon / special trails HC never carried).
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same values.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(config, '{titleStripPatterns}',
      (config->'titleStripPatterns') || '["^TBC$"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Plympton H3 Google Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND jsonb_typeof(config->'titleStripPatterns') = 'array'
  AND NOT (config->'titleStripPatterns') @> '["^TBC$"]'::jsonb;

UPDATE "Source"
SET enabled = true,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE enabled = false
  AND (name, type::text) IN (
    ('Plympton H3 Google Calendar', 'GOOGLE_CALENDAR'),
    ('Sembach H3 Hare Line Sheet', 'GOOGLE_SHEETS')
  );

COMMIT;
