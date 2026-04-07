-- Clear locationCity for events whose canonical source is Harrier Central.
-- Going forward the merge pipeline skips reverse-geocoding on CREATE for HC sources
-- (see #471), but existing rows still have garbage city values like "1, Tokyo".
-- This one-shot cleans them.
--
-- IMPORTANT: filter on Event.sourceUrl (the URL of the source that *created* the
-- canonical event), NOT on a join through RawEvent. A canonical event can have
-- RawEvent rows from multiple sources after a cross-source merge — we only want
-- to clear city when HC was the canonical/primary source. The sourceUrl pattern
-- is the safe signal.

UPDATE "Event"
SET "locationCity" = NULL
WHERE "sourceUrl" LIKE 'https://www.hashruns.org%'
   OR "sourceUrl" LIKE 'https://hashruns.org%';
