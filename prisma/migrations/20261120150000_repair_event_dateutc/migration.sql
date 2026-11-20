-- Repair Event."dateUtc" so it agrees with the event's own "startTime" and
-- "timezone" (the time the event page shows).
--
-- Ships with the merge fix in the same PR: the full-update branch now
-- composes dateUtc from the start time the event keeps, not only the incoming
-- raw's time, and refreshExistingEvent composes from the stored start time.
-- Before that fix, an update without a start time reset dateUtc to UTC noon
-- while startTime kept its value, so calendars and "coming up" showed morning
-- times for evening runs.
--
-- On 2026-11-20, 388 events disagreed (376 CONFIRMED, 12 CANCELLED): 215 with
-- the noon reset and the rest from other causes still under investigation
-- (issue #3084: local time stored as UTC, one-hour offsets, refresh from another source's
-- time). This repairs all of them to the truth startTime + timezone gives.
-- Some of the other-cause rows may drift back until their follow-up issue is
-- fixed.
--
-- Postgres's AT TIME ZONE is used rather than the app's composeUtcStart: they
-- agree on every row except 3 Paraguay events (2023-24), where composeUtcStart
-- returns the wrong month and Postgres is correct. That library bug is tracked in
-- #3084; until it is fixed, the next merge of those 3 events may write the
-- wrong value back.
--
-- A second statement resets the 4 events with no start time whose dateUtc is
-- not their date's UTC noon (left by the old refresh, which composed from the
-- duplicate raw's own time). The fixed merge never composes a time for them.
--
-- Only well-formed HH:MM times and events with a timezone are touched. dateUtc
-- is timestamp-without-time-zone holding UTC, so the expression converts local
-- wall-clock time to UTC and drops the zone.
--
-- Refs #3084. Idempotent: re-running finds no rows that still disagree.

BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "Event"
SET "dateUtc" = ((date::date + "startTime"::time) AT TIME ZONE timezone) AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND timezone IS NOT NULL
  AND "dateUtc" IS DISTINCT FROM (((date::date + "startTime"::time) AT TIME ZONE timezone) AT TIME ZONE 'UTC');

UPDATE "Event"
SET "dateUtc" = date,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "startTime" IS NULL
  AND "dateUtc" IS DISTINCT FROM date;

COMMIT;
