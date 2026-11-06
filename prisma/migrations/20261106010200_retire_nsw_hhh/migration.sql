-- North Shore Wanderers H3 (nswhhh) folded: "After 22 years the club had its
-- last run on Monday 21 Sept 2026" (nswhhh.info). Issue #2585.
-- Data-only and idempotent. Keeps all history; retires the sources and cleans
-- up rows the stale Hareline Sheet left behind.

-- 1. Retire both sources.
UPDATE "Source"
SET "enabled" = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "name" IN ('North Shore Wanderers H3 Hareline Sheet', 'North Shore Wanderers H3 Website')
  AND "enabled" = true;

-- 2. Cancel phantom post-fold runs (Dec 14 #1086, Dec 21 #1087) and the two
--    September weeks the sheet marked "Cancelled" (Sep 7, Sep 14).
UPDATE "Event" e
SET "status" = 'CANCELLED', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."id" = e."kennelId"
  AND k."kennelCode" = 'nswhhh'
  AND e."date"::date IN ('2026-09-07', '2026-09-14', '2026-12-14', '2026-12-21')
  AND e."status" = 'CONFIRMED';

-- 3. Sep 28 was the club's final AGPU, not run #1076.
UPDATE "Event" e
SET "runNumber" = NULL,
    "title" = 'North Shore Wanderers H3 Last AGPU',
    "haresText" = NULL,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k."id" = e."kennelId"
  AND k."kennelCode" = 'nswhhh'
  AND e."date"::date = '2026-09-28'
  AND e."runNumber" = 1076;

-- 4. Activity badge reads lastEventDate; point it at the final gathering.
UPDATE "Kennel"
SET "lastEventDate" = '2026-09-28 12:00:00'
WHERE "kennelCode" = 'nswhhh';
