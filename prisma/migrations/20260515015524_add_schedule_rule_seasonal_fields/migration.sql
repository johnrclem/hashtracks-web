-- Add multi-cadence display fields to ScheduleRule (#1390).
--
-- ScheduleRule becomes the authoritative multi-slot store for both Travel Mode
-- projection and kennel-page display. `label` is a human cadence tag ("Summer",
-- "Winter", "Full Moon Special"). `validFrom` / `validUntil` use MM-DD anchors
-- because seasonality wraps across years (e.g. "11-01" to "02-28" = winter).
-- `displayOrder` controls render order when a kennel has ≥2 active rules.
--
-- All three text columns are nullable; `displayOrder` defaults to 0. The change
-- is purely additive — no existing rows need backfilling because the legacy
-- flat-field path on `Kennel` (scheduleDayOfWeek + scheduleTime + scheduleFrequency)
-- remains the fallback when a kennel has zero ScheduleRule rows or zero rules
-- with label/validFrom/validUntil set.

ALTER TABLE "ScheduleRule"
  ADD COLUMN "label"        TEXT,
  ADD COLUMN "validFrom"    TEXT,
  ADD COLUMN "validUntil"   TEXT,
  ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
