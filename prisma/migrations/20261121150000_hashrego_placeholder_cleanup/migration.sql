-- Clear Hash Rego placeholders already stored on canonical events.
--
-- Ships with the parser cleanup in the same PR (docs/kennel-external-ids-plan.md
-- section 5.6, PR A): the Hash Rego parser now omits placeholder locations,
-- hares and the joke price, and cuts a dated tail from titles. Omitted fields
-- keep whatever is stored, so values written before the fix stay unless this
-- clears them. A cleared field can then be filled by another source.
--
-- Read-only check on 2026-11-21 found 12 values on 12 events backed by Hash
-- Rego (3 upcoming): 8 placeholder locations, 2 placeholder hares and 2 dated
-- EWH3 titles. No stored cost is the joke price. Every statement names its
-- rows and checks the current value, so a value someone has since corrected is
-- left alone and re-running the migration changes nothing.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. "Start Location TBA" / "Location TBD" (bfm, bfh3, philly-h3, ewh3).
UPDATE "Event"
SET "locationName" = NULL,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id IN (
    'cmn3aoun600vv04lhtqht5nud', 'cmr5f3z6v003b04kyinv8mgf5', 'cmr5f3zbx003d04kywc1m24o1',
    'cmr5f3zgw003f04ky6a9ll1oc', 'cmt0ksl6x005c04jurjfy7f9k', 'cmnooryj2002e04jyhqni3ur0',
    'cmwnk3agx000608l842u474uv', 'cmmfehx7z002x04jo7snaveq6'
  )
  AND lower(trim("locationName")) IN ('start location tba', 'location tbd');

-- 2. The ewh3 2026-11-02 event's address is a Maps search for "Location TBD".
UPDATE "Event"
SET "locationAddress" = NULL,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmmfehx7z002x04jo7snaveq6'
  AND "locationAddress" LIKE '%query=Location\%20TBD';

-- 3. Hares "Away: 3:30pm" and "NA" (wh4).
UPDATE "Event"
SET "haresText" = NULL,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE (id = 'cmr2iwo61001304l1jksvie8t' AND "haresText" = 'Away: 3:30pm')
   OR (id = 'cmr2iwp0d002004l1v8texkpr' AND "haresText" = 'NA');

-- 4. Dated EWH3 titles, cut as the parser now cuts them.
UPDATE "Event"
SET title = 'EWH3 #1525: The In-de-penis from Britain Trail',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmlrh0ftb004204jxvy23hulm'
  AND title LIKE 'EWH3 #1525: The In-de-penis from Britain Trail, July 2nd, 2026,%';

UPDATE "Event"
SET title = 'EWH3 #1529: The Friendship Slip n Slide Trail',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmlrh0fvf004a04jxnhdp7glw'
  AND title LIKE 'EWH3 #1529: The Friendship Slip n Slide Trail, 30 July, 2026,%';

COMMIT;
