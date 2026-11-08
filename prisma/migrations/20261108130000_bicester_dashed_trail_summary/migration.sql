-- Bicester H3 (#2802, #2803): parse the "Trail # N - <hare> - <venue>" SUMMARY with the
-- dashedTrailSummary option instead of titleHarePattern.
-- DATA-ONLY and idempotent. prisma/seed-data/sources.ts carries the same values.

UPDATE "Source"
SET config = (config - 'titleHarePattern') || '{"dashedTrailSummary": true}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Bicester H3 Events (The Events Calendar iCal)' AND type = 'ICAL_FEED';
