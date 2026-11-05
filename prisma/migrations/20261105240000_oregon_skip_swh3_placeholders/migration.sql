-- Oregon Hashing Calendar: skip SWH3 "More Detrails to Follow" placeholders.
--
-- The 2026-11-05 wide-backfill preview found 61 of the 74 SWH3 entries on this
-- aggregator (2018-2024) are placeholders with no run number or details. SWH3
-- has its own calendar source, so drop them here before the history backfill.
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts matches.

UPDATE "Source"
SET config = config || jsonb_build_object('skipPatterns', jsonb_build_array('^[^A-Za-z0-9]*SWH3\b.*More Detrails to Follow')),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Oregon Hashing Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND config->'skipPatterns' IS DISTINCT FROM jsonb_build_array('^[^A-Za-z0-9]*SWH3\b.*More Detrails to Follow');
