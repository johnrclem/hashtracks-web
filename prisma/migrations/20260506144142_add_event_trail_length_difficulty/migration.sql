-- Issue #890: First-class trail length + Shiggy Scale on Event.
--
-- Three-field shape preserves source intent:
--   * trailLengthText  — verbatim string ("3-5 Miles", "2.69 (miles)")
--   * trailLengthMinMiles / trailLengthMaxMiles — parsed numerics
--     (min == max for fixed values, distinct for ranges)
--
-- difficulty is a 1–5 Shiggy Scale, validated at the adapter layer
-- (Prisma can't enforce range). Column name stays generic so other
-- adapters' "rating"/"hardness" fields can land here later.
--
-- Hand-authored: `prisma migrate dev` couldn't run a shadow-DB pass
-- because pending migration `20260504010411_kennel_profile_bundle...`
-- has a kennelCode existence guard that fails on an empty shadow DB.
-- Diff was generated via `prisma migrate diff --from-config-datasource
-- --to-schema prisma/schema.prisma --script`.

ALTER TABLE "Event" ADD COLUMN     "trailLengthText" TEXT,
ADD COLUMN     "trailLengthMinMiles" DOUBLE PRECISION,
ADD COLUMN     "trailLengthMaxMiles" DOUBLE PRECISION,
ADD COLUMN     "difficulty" INTEGER;
