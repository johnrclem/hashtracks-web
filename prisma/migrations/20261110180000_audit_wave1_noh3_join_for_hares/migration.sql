-- NOH3 Google Calendar (#2849): add a hare pattern for the "Join X, Y and Z for
-- this hash!" description form, so run #1983 (and 10 other 2026 runs) get their
-- real hares instead of none / the title's "(parking lot)".
-- DATA-ONLY and idempotent: appends the pattern only when it is not already in
-- the array, leaving prod's other patterns untouched. prisma/seed-data/sources.ts
-- carries the same value.

UPDATE "Source"
SET config = jsonb_set(
      config,
      '{harePatterns}',
      COALESCE(config->'harePatterns', '[]'::jsonb)
        || to_jsonb('Join\s+(?!(?:us|her|him|them|me)\b)([A-Za-z0-9][A-Za-z0-9 ,''’&]+?)(?:\s+at\s+[A-Za-z0-9 ,''’&]+?)?\s+for\b'::text)
    ),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'NOH3 Google Calendar'
  AND type = 'GOOGLE_CALENDAR'
  AND NOT COALESCE(config->'harePatterns', '[]'::jsonb)
        @> jsonb_build_array('Join\s+(?!(?:us|her|him|them|me)\b)([A-Za-z0-9][A-Za-z0-9 ,''’&]+?)(?:\s+at\s+[A-Za-z0-9 ,''’&]+?)?\s+for\b'::text);
