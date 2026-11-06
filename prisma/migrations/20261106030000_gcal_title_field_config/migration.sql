-- GCal title-field config fixes (#2598 EWH3, #2652 Stuttgart).
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts matches.

-- EWH3: "{theme} - {hares}" summaries put hare lists into locationName.
-- A comma-bearing last " - " segment is hares; the location is only the last
-- comma-free " - " segment.
UPDATE "Source"
SET config = config || jsonb_build_object(
      'titleHarePattern', '\s-\s+((?:(?!\s-\s).)+,(?:(?!\s-\s).)+)$',
      'titleLocationPattern', '\s-\s+((?:(?!\s-\s)[^,])+)$'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'EWH3 Google Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (config->>'titleHarePattern' IS DISTINCT FROM '\s-\s+((?:(?!\s-\s).)+,(?:(?!\s-\s).)+)$'
    OR config->>'titleLocationPattern' IS DISTINCT FROM '\s-\s+((?:(?!\s-\s)[^,])+)$');

-- Stuttgart: always strip the title's "Hare: X" span even when the description
-- already supplied the hare; also strip a ":" after the run number.
UPDATE "Source"
SET config = config || jsonb_build_object(
      'alwaysStripTitleHareSpan', true,
      'titleStripPatterns', jsonb_build_array(
        '^SH3\s*(?:#\s*)?\d+\s*(?:[-:]\s*)?',
        '^FM\s*(?:#\s*)?\d+\s*(?:-\s*)?')),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Stuttgart H3 Google Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (config->'alwaysStripTitleHareSpan' IS DISTINCT FROM 'true'::jsonb
    OR config->'titleStripPatterns'->>0 IS DISTINCT FROM '^SH3\s*(?:#\s*)?\d+\s*(?:[-:]\s*)?');
