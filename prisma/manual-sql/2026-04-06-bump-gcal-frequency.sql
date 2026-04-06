-- Bump all GOOGLE_CALENDAR sources from daily → every_6h.
-- Apply manually after merging the PR (db push doesn't update existing rows).
-- 81 sources × 4 scrapes/day = 324 GCal API calls/day, well under the 1M/day free tier.

UPDATE "Source"
SET "scrapeFreq" = 'every_6h'
WHERE "type" = 'GOOGLE_CALENDAR'
  AND "scrapeFreq" = 'daily';
