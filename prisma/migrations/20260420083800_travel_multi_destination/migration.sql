-- Travel Mode multi-destination support (up to 3 stops per trip).
--
-- Summary:
--   1. Add DRAFT to TravelSearchStatus enum. Multi-dest trips auto-save as
--      DRAFT on leg-2-add; invisible from /travel/saved; reachable by URL.
--   2. Add TravelSearch.itinerarySignature (nullable, SHA-256 hex) for O(1)
--      trip-level dedup. Backfilled per existing single-dest row, then
--      partial-unique'd on (userId, itinerarySignature) WHERE status='ACTIVE'.
--   3. Replace TravelDestination.travelSearchId @unique with compound
--      @@unique([travelSearchId, position]). position is 0-indexed; v1 caps
--      at 0..2 via application-layer validation.
--   4. Drop the destination-level partial-unique
--      (TravelDestination_user_dedup_active). Dedup now lives at the trip
--      level via itinerarySignature — a user can legitimately have the same
--      destination coords+dates in two different multi-stop itineraries
--      (e.g. London Mon-Thu solo AND London Mon-Thu + Paris Thu-Sun).
--
-- Feature is live in production with real saved trips, so the position
-- column and signature column both backfill in-place. Signature is
-- computed to match the actions.ts canonical format (see
-- computeItinerarySignature()).

-- 1. Extend the enum with DRAFT.
ALTER TYPE "TravelSearchStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';

-- 2. Add itinerarySignature column to TravelSearch (nullable for backfill).
ALTER TABLE "TravelSearch"
  ADD COLUMN "itinerarySignature" VARCHAR(64);

-- 3. Drop the old 1:1 unique on TravelDestination.travelSearchId so
--    multiple destinations can share a parent. Prisma authored this as
--    both a constraint and a unique index; drop both defensively.
ALTER TABLE "TravelDestination" DROP CONSTRAINT IF EXISTS "TravelDestination_travelSearchId_key";
DROP INDEX IF EXISTS "TravelDestination_travelSearchId_key";

-- 4. Add position column, default 0 so existing rows backfill to the
--    first (and only) slot, then drop the default to force explicit
--    assignment on new inserts.
ALTER TABLE "TravelDestination"
  ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TravelDestination"
  ALTER COLUMN "position" DROP DEFAULT;

-- 5. Compound unique: exactly one destination per (trip, slot).
CREATE UNIQUE INDEX "TravelDestination_travelSearchId_position_key"
  ON "TravelDestination"("travelSearchId", "position");

-- 6. Keep the non-unique FK-lookup index Prisma added via @@index.
CREATE INDEX "TravelDestination_travelSearchId_idx"
  ON "TravelDestination"("travelSearchId");

-- 7. Drop the destination-level partial-unique. The trip-level signature
--    index below replaces it. Two different multi-stop trips legitimately
--    sharing one destination tuple (e.g. London Mon-Thu solo AND a
--    London→Paris trip with London Mon-Thu as leg 01) must BOTH be
--    allowed under the new model.
DROP INDEX IF EXISTS "TravelDestination_user_dedup_active";

-- 8. Backfill itinerarySignature for existing rows. Each existing trip
--    has exactly one destination (the 1:1 invariant held until this
--    migration), so the signature is a SHA-256 of a canonical JSON
--    representation of that single stop. The format MUST match
--    computeItinerarySignature() in src/app/travel/actions.ts.
--
--    Canonical format (per stop, sorted key order):
--      {
--        "position": <int>,
--        "placeId": <string|null>,
--        "latitude": <float>,         // only when placeId is null
--        "longitude": <float>,        // only when placeId is null
--        "radiusKm": <int>,
--        "startDate": <ISO date>,
--        "endDate": <ISO date>
--      }
--    then JSON.stringify the array (position-ordered), SHA-256, hex-encode.
--
--    We can't easily compute SHA-256 in pure SQL without an extension, so
--    we use pgcrypto (already available on Railway's default Postgres).
--    If pgcrypto is not available, this will fail — in that case install
--    it first: CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

UPDATE "TravelSearch" ts
SET "itinerarySignature" = ENCODE(
  DIGEST(
    -- Build a canonical JSON array with one stop object. Key ordering is
    -- fixed to match the application's JSON.stringify of an object built
    -- in the same order. The omit-coords-when-placeId-exists rule is
    -- reproduced inline.
    '[' || (
      CASE
        WHEN td."placeId" IS NOT NULL AND td."placeId" <> '' THEN
          json_build_object(
            'position', td."position",
            'placeId', td."placeId",
            'radiusKm', td."radiusKm",
            'startDate', to_char(td."startDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
            'endDate', to_char(td."endDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          )::text
        ELSE
          json_build_object(
            'position', td."position",
            'placeId', NULL,
            'latitude', td."latitude",
            'longitude', td."longitude",
            'radiusKm', td."radiusKm",
            'startDate', to_char(td."startDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
            'endDate', to_char(td."endDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          )::text
      END
    ) || ']',
    'sha256'
  ),
  'hex'
)
FROM "TravelDestination" td
WHERE td."travelSearchId" = ts."id";

-- 9. Trips that somehow have zero destinations (shouldn't exist, but
--    defend anyway) get an empty-array signature so the NOT NULL below
--    holds. These rows won't collide with anything since no real save
--    path creates empty itineraries.
UPDATE "TravelSearch"
SET "itinerarySignature" = ENCODE(DIGEST('[]', 'sha256'), 'hex')
WHERE "itinerarySignature" IS NULL;

-- 10. Make itinerarySignature NOT NULL now that every row is filled.
ALTER TABLE "TravelSearch"
  ALTER COLUMN "itinerarySignature" SET NOT NULL;

-- 11. Partial unique — the trip-level dedup. Only ACTIVE trips participate;
--     DRAFT and ARCHIVED are free to collide. ARCHIVED rows can sit
--     indefinitely; DRAFT rows are expected to collide when a user
--     iterates on the same itinerary and get GC'd by a future cron.
CREATE UNIQUE INDEX "TravelSearch_user_itinerary_active"
  ON "TravelSearch"("userId", "itinerarySignature")
  WHERE "status" = 'ACTIVE';
