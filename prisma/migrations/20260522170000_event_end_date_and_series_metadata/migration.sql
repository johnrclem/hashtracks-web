-- Add Event.endDate for multi-day event support (#1560).
--
-- Used by:
--   * Series PARENT rows (umbrellas spanning N children) — endDate = last child's date.
--   * Single-row date-range events with no children (one-registration weekend
--     campouts — MadisonH3 case) — endDate set on the single canonical row.
--
-- Single-day events keep endDate = NULL. The UI inspects (isSeriesParent OR endDate IS NOT NULL)
-- to decide whether to render the multi-day card treatment.
--
-- Hand-written (not `migrate dev`-generated) because a pre-existing data migration
-- in this repo refuses to run on Prisma's empty shadow database. This migration
-- is a pure additive ADD COLUMN — safe under prod load, no data backfill needed,
-- nullable so existing rows pass NOT NULL checks trivially.

ALTER TABLE "Event" ADD COLUMN "endDate" TIMESTAMP(3);
