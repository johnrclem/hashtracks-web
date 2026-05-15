-- Repair Kennel slugs that contain a literal "/" (#1422).
--
-- Background: `toSlug()` in both `prisma/seed.ts` and `src/lib/kennel-utils.ts`
-- replaced spaces with hyphens but left `/` intact, so the H2H3 / Cha-Am H3
-- record was persisted with slug `h2h3-/-cha-am-h3`. Next.js treats `/` as a
-- path separator inside route segments, so `/kennels/[slug]` never matched
-- and the public kennel page returned a 404.
--
-- Companion fixes (already applied in TypeScript):
--   * Both `toSlug()` helpers now normalize `[^a-z0-9]+` runs to `-`, so new
--     kennels cannot reintroduce the bug.
--   * `prisma/seed-data/kennels.ts` carries an explicit `slug` on the H2H3
--     record so future seeds re-create it cleanly if the row is ever dropped.
--
-- This migration repairs any *existing* row whose slug contains `/`. The same
-- regex normalization is performed in SQL so any other slash-bearing slugs in
-- prod (none known today, but defensive) are corrected idempotently.
--
-- No-op when no slashes are present, so it's safe to re-run.

UPDATE "Kennel"
SET slug = REGEXP_REPLACE(
  REGEXP_REPLACE(LOWER(slug), '[^a-z0-9]+', '-', 'g'),
  '^-|-$',
  '',
  'g'
)
WHERE slug LIKE '%/%';
