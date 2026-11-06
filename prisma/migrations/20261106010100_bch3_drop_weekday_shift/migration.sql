-- Brew City H3 Website: drop config.weekdayShift.
--
-- Wix server-renders BCH3's date headings in UTC ("Friday … AT 1 AM" is a
-- Thursday 7 PM Milwaukee run). BrewCityH3Adapter now converts the heading to
-- America/Chicago, so the old Friday→Thursday / 20:00 remap is obsolete (and is
-- inert under the new parser, which always yields a start time). DATA-ONLY,
-- idempotent; the seed matches. (#2658/#2678)

BEGIN;

UPDATE "Source"
SET config = config - 'weekdayShift',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Brew City H3 Website'
  AND type::text = 'HTML_SCRAPER'
  AND config ? 'weekdayShift';

COMMIT;
