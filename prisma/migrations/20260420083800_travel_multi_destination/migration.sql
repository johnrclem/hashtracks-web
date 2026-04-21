-- Travel Mode multi-destination support (up to 3 stops per trip).
--
-- Summary:
--   1. Add DRAFT to TravelSearchStatus enum. Multi-dest trips auto-save as
--      DRAFT on leg-2-add; invisible from /travel/saved; reachable by URL.
--   2. Add TravelSearch.itinerarySignature (nullable, SHA-256 hex) for O(1)
--      trip-level dedup. Partial-unique'd on (userId, itinerarySignature)
--      WHERE status='ACTIVE' AND itinerarySignature IS NOT NULL.
--      Nullable because the SQL serializer and the JS serializer are not
--      guaranteed byte-identical — backfilling in SQL would risk writing
--      signatures that the application's computeItinerarySignature() can
--      never reproduce, silently breaking dedup lookups. Instead, existing
--      rows stay NULL and the next save/update through the application
--      populates the column with a TS-computed signature.
--   3. Replace TravelDestination.travelSearchId @unique with compound
--      @@unique([travelSearchId, position]). position is 0-indexed; v1 caps
--      at 0..2 via application-layer validation.
--   4. Drop the destination-level partial-unique
--      (TravelDestination_user_dedup_active). Dedup now lives at the trip
--      level via itinerarySignature — a user can legitimately have the same
--      destination coords+dates in two different multi-stop itineraries
--      (e.g. London Mon-Thu solo AND London Mon-Thu + Paris Thu-Sun).

-- 1. Extend the enum with DRAFT.
ALTER TYPE "TravelSearchStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';

-- 2. Add itinerarySignature column to TravelSearch (nullable — populated by
--    the application on next save/update; see header note).
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

-- 8. Partial unique — the trip-level dedup. Only ACTIVE trips with a
--    populated signature participate. Legacy rows with NULL signatures
--    sit outside the index until the application rewrites them on next
--    save/update via computeItinerarySignature().
CREATE UNIQUE INDEX "TravelSearch_user_itinerary_active"
  ON "TravelSearch"("userId", "itinerarySignature")
  WHERE "status" = 'ACTIVE' AND "itinerarySignature" IS NOT NULL;
