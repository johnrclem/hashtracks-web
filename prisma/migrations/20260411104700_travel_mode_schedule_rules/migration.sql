-- CreateEnum
CREATE TYPE "ScheduleConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ScheduleRuleSource" AS ENUM ('STATIC_SCHEDULE', 'SEED_DATA', 'ADMIN', 'INFERRED');

-- CreateTable
CREATE TABLE "ScheduleRule" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "rrule" TEXT NOT NULL,
    "anchorDate" TEXT,
    "startTime" TEXT,
    "confidence" "ScheduleConfidence" NOT NULL DEFAULT 'MEDIUM',
    "source" "ScheduleRuleSource" NOT NULL DEFAULT 'SEED_DATA',
    "sourceReference" TEXT,
    "lastValidatedAt" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravelSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravelDestination" (
    "id" TEXT NOT NULL,
    "travelSearchId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "placeId" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "timezone" TEXT,
    "radiusKm" INTEGER NOT NULL DEFAULT 50,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravelDestination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleRule_kennel_rrule_source_key" ON "ScheduleRule"("kennelId", "rrule", "source");

-- CreateIndex
CREATE INDEX "ScheduleRule_kennelId_idx" ON "ScheduleRule"("kennelId");

-- CreateIndex
CREATE INDEX "ScheduleRule_isActive_confidence_idx" ON "ScheduleRule"("isActive", "confidence");

-- CreateIndex
CREATE INDEX "TravelSearch_userId_status_idx" ON "TravelSearch"("userId", "status");

-- CreateIndex
CREATE INDEX "TravelSearch_userId_lastViewedAt_idx" ON "TravelSearch"("userId", "lastViewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TravelDestination_travelSearchId_key" ON "TravelDestination"("travelSearchId");

-- AddForeignKey
ALTER TABLE "ScheduleRule" ADD CONSTRAINT "ScheduleRule_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelSearch" ADD CONSTRAINT "TravelSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravelDestination" ADD CONSTRAINT "TravelDestination_travelSearchId_fkey" FOREIGN KEY ("travelSearchId") REFERENCES "TravelSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Hand-written invariants (not Prisma-expressible)
-- ============================================================

-- Stronger NULL-aware dedup key for ScheduleRule: treats NULL anchorDate/startTime as
-- empty strings so backfill retries can't create near-duplicate rules that differ
-- only by whether anchorDate or startTime is NULL. Paired with the Prisma-level
-- @@unique([kennelId, rrule, source]) as belt-and-suspenders. Writers should use
-- upsert() with the natural key to be idempotent.
CREATE UNIQUE INDEX "ScheduleRule_kennel_rrule_anchor_start_source_idx"
  ON "ScheduleRule" (
    "kennelId",
    "rrule",
    COALESCE("anchorDate", ''),
    COALESCE("startTime", ''),
    "source"
  );

-- Date range invariant: TravelDestination.endDate must be >= startDate. Enforced
-- at the DB level so inverted windows (timezone conversion bugs, form glitches,
-- API misuse) are rejected outright. Application layer also validates.
ALTER TABLE "TravelDestination"
  ADD CONSTRAINT "TravelDestination_date_range_check"
  CHECK ("endDate" >= "startDate");

-- UTC-noon invariant: travel dates follow the repo's date convention where
-- dates are stored as UTC noon (12:00:00) to avoid DST-related off-by-one
-- errors. This constraint rejects any timestamp that doesn't have 12:00:00
-- as the time component. Application layer normalizes to UTC noon before write.
ALTER TABLE "TravelDestination"
  ADD CONSTRAINT "TravelDestination_utc_noon_start"
  CHECK (EXTRACT(HOUR FROM "startDate") = 12
     AND EXTRACT(MINUTE FROM "startDate") = 0
     AND EXTRACT(SECOND FROM "startDate") = 0);
ALTER TABLE "TravelDestination"
  ADD CONSTRAINT "TravelDestination_utc_noon_end"
  CHECK (EXTRACT(HOUR FROM "endDate") = 12
     AND EXTRACT(MINUTE FROM "endDate") = 0
     AND EXTRACT(SECOND FROM "endDate") = 0);
