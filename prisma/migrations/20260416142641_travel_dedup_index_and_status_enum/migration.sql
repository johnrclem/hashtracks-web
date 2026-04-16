-- Travel Mode dedup hardening + status enum
--
-- Two coordinated schema changes that go together because they share the
-- same target tables (TravelSearch + TravelDestination) and the feature
-- has not yet shipped to production (zero rows in either table) so we can
-- bundle them without a backfill.
--
-- 1. TravelSearchStatus enum — replaces plain TEXT status column with a
--    proper enum (parallel to EventStatus / AttendanceStatus). Prevents
--    typo'd status values like "activve".
-- 2. TravelDestination dedup unique index — closes the saveTravelSearch
--    race (double-click, manual + auto-save, cross-tab) that could
--    otherwise insert duplicate active rows. userId is denormalized onto
--    TravelDestination so the unique can sit on a single table; archive
--    deletes the destination row to free the unique slot for re-save.

-- 1. TravelSearchStatus enum
-- 'ACTIVE' / 'ARCHIVED' literals appear several times below; SonarCloud
-- flags this as duplicated-literal but Postgres has no native const
-- mechanism (a CREATE FUNCTION wrapper for a one-time migration would
-- be overkill). Per-line NOSONAR markers below suppress the noise.
CREATE TYPE "TravelSearchStatus" AS ENUM ('ACTIVE', 'ARCHIVED'); -- NOSONAR

-- 2. Convert TravelSearch.status from TEXT to TravelSearchStatus.
--    Empty table at this point in the rollout, so the USING clause is
--    just for completeness — there are no rows to migrate.
ALTER TABLE "TravelSearch"
  ALTER COLUMN "status" DROP DEFAULT,
  ALTER COLUMN "status" TYPE "TravelSearchStatus" USING (
    CASE UPPER("status")
      WHEN 'ACTIVE'   THEN 'ACTIVE'::"TravelSearchStatus" -- NOSONAR
      WHEN 'ARCHIVED' THEN 'ARCHIVED'::"TravelSearchStatus" -- NOSONAR
      ELSE 'ACTIVE'::"TravelSearchStatus" -- NOSONAR
    END
  ),
  ALTER COLUMN "status" SET DEFAULT 'ACTIVE'; -- NOSONAR

-- 3. Add userId to TravelDestination (denormalized from TravelSearch.userId).
--    NOT NULL is safe because the table is empty.
ALTER TABLE "TravelDestination" ADD COLUMN "userId" TEXT NOT NULL;

-- 4. FK to User with cascade delete (User → TravelDestination cleanup
--    matches TravelSearch's existing User relation).
ALTER TABLE "TravelDestination"
  ADD CONSTRAINT "TravelDestination_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Index for FK + filter performance.
CREATE INDEX "TravelDestination_userId_idx" ON "TravelDestination"("userId");

-- 6. Active-trip dedup. Archive (status=ARCHIVED) deletes the destination
--    row, so an "archived" row in TravelSearch never holds the unique slot.
CREATE UNIQUE INDEX "TravelDestination_user_dedup"
  ON "TravelDestination"("userId", "latitude", "longitude", "radiusKm", "startDate", "endDate");
