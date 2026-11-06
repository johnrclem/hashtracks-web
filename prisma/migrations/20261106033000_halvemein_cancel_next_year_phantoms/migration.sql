-- Halve Mein: cancel next-year phantoms of runs that were still listed on the
-- year-less upcoming page after their date. chrono forwardDate rolled each one
-- (#825-#839 + KNURD Camp Crawl) to 2027; the adapter now picks the year from
-- the Day column. Only rows with a CONFIRMED same-month/day twin exactly one
-- year earlier (same run number, or both NULL) are touched; all 16 have 0
-- attendances and a single RawEvent. Cancelled, not deleted (reversible).
-- DATA-ONLY, idempotent.
UPDATE "Event" p
SET status = 'CANCELLED', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = p."kennelId"
  AND k."kennelCode" = 'halvemein'
  AND p.status = 'CONFIRMED'
  AND p.date >= '2027-01-01' AND p.date < '2028-01-01'
  AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = p.id)
  AND EXISTS (
    SELECT 1 FROM "Event" t
    WHERE t."kennelId" = p."kennelId"
      AND t.id <> p.id
      AND t.status = 'CONFIRMED'
      AND t.date = p.date - INTERVAL '1 year'
      AND t."runNumber" IS NOT DISTINCT FROM p."runNumber"
  );
