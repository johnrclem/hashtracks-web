-- NOTE on duplicate string literals: SonarCloud flags `'ACTIVE'` as
-- "duplicated 3 times." Postgres SQL has no native const declaration
-- (CREATE FUNCTION returning the constant would be overkill for a
-- one-time migration). The literal corresponds to the
-- `TravelSearchStatus.ACTIVE` enum variant — the same value referenced
-- twice in this file (DEFAULT clause + partial-unique WHERE) and once
-- below in the index name. Inlined for readability.
--
-- Travel Mode dedup: address codex adversarial findings on the prior
-- design (travel_dedup_index_and_status_enum). Three structural issues:
--
--   1. The full unique index on (userId, lat, lng, radius, dates)
--      depended on the *application* deleting the destination row when
--      archiving the parent search. Any other writer (manual SQL, future
--      code path) could leave an archived parent with a live destination
--      row, blocking re-saves with a P2002 the user can't recover from.
--      → Replace with a partial unique gated on status = 'ACTIVE'.
--      → Denormalize status onto TravelDestination so the partial-unique
--        WHERE clause can reference a column on the indexed table.
--
--   2. TravelDestination had two independent FKs (one to TravelSearch,
--      one to User) with nothing tying their userIds together — codex
--      flagged this as a tenant-isolation hazard.
--      → Replace the parent FK with a compound FK on (travelSearchId,
--        userId) targeting TravelSearch(id, userId) (new compound key).
--
--   3. The new partial unique still throws P2002 on conflicts; the
--      saveTravelSearch path catches it but updateTravelSearch did not.
--      Handled in the corresponding actions.ts change.
--
-- Tables are empty in production (feature has not yet shipped) so this
-- migration drops/recreates without backfill concerns.

-- 1. Drop the prior unconditional unique + the prior ON DELETE CASCADE
--    parent FK so we can replace them with partial-unique + compound FK.
DROP INDEX "TravelDestination_user_dedup";
ALTER TABLE "TravelDestination" DROP CONSTRAINT "TravelDestination_travelSearchId_fkey";

-- 2. Compound key target on TravelSearch so TravelDestination's compound
--    FK can reference (id, userId) and the DB guarantees the two userIds
--    agree.
CREATE UNIQUE INDEX "TravelSearch_id_userId" ON "TravelSearch"("id", "userId");

-- 3. Add status to TravelDestination, mirroring TravelSearch.status.
--    Application keeps them in sync; DB-level enforcement is the partial
--    unique index below — an out-of-sync row (status=ACTIVE on the
--    destination, ARCHIVED on the parent) would be visible only to a
--    manual-SQL writer, and even then the worst case is a stuck dedup
--    slot that the partial unique still ignores once both sides flip.
ALTER TABLE "TravelDestination" ADD COLUMN "status" "TravelSearchStatus" NOT NULL DEFAULT 'ACTIVE';

-- 4. Recreate the parent FK as compound (travelSearchId, userId) →
--    TravelSearch(id, userId). Keeps cascade-on-parent-delete behavior.
ALTER TABLE "TravelDestination"
  ADD CONSTRAINT "TravelDestination_travelSearchId_userId_fkey"
  FOREIGN KEY ("travelSearchId", "userId")
  REFERENCES "TravelSearch"("id", "userId")
  ON DELETE CASCADE
  ON UPDATE CASCADE;

-- 5. Partial unique index — the actual dedup enforcement. Only ACTIVE
--    destination rows participate; archived rows can sit indefinitely
--    without blocking re-saves of the same trip.
CREATE UNIQUE INDEX "TravelDestination_user_dedup_active"
  ON "TravelDestination"("userId", "latitude", "longitude", "radiusKm", "startDate", "endDate")
  WHERE "status" = 'ACTIVE';

-- 6. Helper index for status-filtered queries (listSavedSearches +
--    findExistingSavedSearch read patterns).
CREATE INDEX "TravelDestination_userId_status_idx" ON "TravelDestination"("userId", "status");
