-- Opt the ABQ H3 Google Calendar source into all-day event ingestion AND
-- set a defaultStartTime fallback (#536). The kennel enters their Tuesday
-- "CLiT" trails as all-day calendar entries. The gcal adapter skips all-day
-- events by default; opt in so they land in the hareline, but pair with
-- defaultStartTime: "18:00" so they render as 6pm runs rather than all-day
-- blocks (the Saturday + Full Moon Wed events already carry a proper
-- dateTime and bypass this fallback).
--
-- Seed file (prisma/seed-data/sources.ts) is updated in the same PR so
-- fresh installs reproduce. Per convention `prisma db seed` is never run
-- against prod; production config drifts via SQL one-shots like this.

UPDATE "Source"
SET config = jsonb_set(
  jsonb_set(
    COALESCE(config, '{}'::jsonb),
    '{includeAllDayEvents}',
    'true'::jsonb,
    true
  ),
  '{defaultStartTime}',
  '"18:00"'::jsonb,
  true
)
WHERE name = 'ABQ H3 Google Calendar'
  AND type = 'GOOGLE_CALENDAR';

DO $$
DECLARE
  flag boolean;
  default_time text;
BEGIN
  SELECT (config->>'includeAllDayEvents')::boolean,
         config->>'defaultStartTime'
    INTO flag, default_time
  FROM "Source"
  WHERE name = 'ABQ H3 Google Calendar' AND type = 'GOOGLE_CALENDAR';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ABQ H3 Google Calendar source not found — refusing to silently no-op';
  END IF;
  IF flag IS NOT TRUE THEN
    RAISE EXCEPTION 'includeAllDayEvents did not land: %', COALESCE(flag::text, 'NULL');
  END IF;
  IF default_time IS DISTINCT FROM '18:00' THEN
    RAISE EXCEPTION 'defaultStartTime did not land: %', COALESCE(default_time, 'NULL');
  END IF;
END $$;
