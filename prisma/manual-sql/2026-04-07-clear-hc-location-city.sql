-- Clear locationCity for events sourced from HARRIER_CENTRAL.
-- Going forward the merge pipeline skips reverse-geocoding for HC sources
-- (see #471), but existing rows still have garbage city values like
-- "1, Tokyo" appended in the display. This one-shot cleans them.

UPDATE "Event"
SET "locationCity" = NULL
WHERE "sourceUrl" LIKE 'https://www.hashruns.org%'
   OR "sourceUrl" LIKE 'https://hashruns.org%'
   OR "id" IN (
     SELECT e.id
     FROM "Event" e
     JOIN "RawEvent" re ON re."eventId" = e.id
     JOIN "Source" s ON s.id = re."sourceId"
     WHERE s.type = 'HARRIER_CENTRAL'
   );
