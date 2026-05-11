-- Issue #1316: First-class trailType / dogFriendly / prelube on Event.
--
-- The SDH3 hareline emits per-event "Trail type:" / "Dog friendly:" /
-- "Pre-lube:" labels that the adapter currently smashes into description
-- as "Hash Cash: 5 | Trail: A to A | Dog Friendly: Yes | …". Promoting
-- them to typed columns lets the UI render them as discrete facts and
-- frees the description field for the actual Notes body.
--
-- All three are nullable — adapters that don't surface these labels
-- (every adapter except SDH3 today) leave them null. dogFriendly uses
-- the standard tri-state: null = unknown / not stated; true/false = explicit.
--
-- Hand-authored: `prisma migrate dev` couldn't run a shadow-DB pass
-- because pending migration `20260504010411_kennel_profile_bundle...`
-- has a kennelCode existence guard that fails on an empty shadow DB
-- (same blocker that #1266 / #890 hit and worked around the same way).
-- Diff was generated via `prisma migrate diff --from-config-datasource
-- --to-schema prisma/schema.prisma --script`.

ALTER TABLE "Event" ADD COLUMN     "trailType" TEXT,
ADD COLUMN     "dogFriendly" BOOLEAN,
ADD COLUMN     "prelube" TEXT;
