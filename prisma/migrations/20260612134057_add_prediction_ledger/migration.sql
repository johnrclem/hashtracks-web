-- CreateEnum
CREATE TYPE "PredictionOutcome" AS ENUM ('PENDING', 'HIT', 'MISS', 'PRECONFIRMED', 'UNOBSERVED');

-- CreateTable
CREATE TABLE "PredictionSnapshot" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "scheduleRuleId" TEXT,
    "predictedDate" TIMESTAMP(3) NOT NULL,
    "startTimeKey" TEXT NOT NULL,
    "startTime" TEXT,
    "confidence" "ScheduleConfidence" NOT NULL,
    "horizonBucket" INTEGER NOT NULL,
    "daysOutAtSnapshot" INTEGER NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAtSnapshot" BOOLEAN NOT NULL,
    "preexistingEventId" TEXT,
    "independentSourceIds" TEXT[],
    "outcome" "PredictionOutcome" NOT NULL DEFAULT 'PENDING',
    "scoredAt" TIMESTAMP(3),
    "matchedEventId" TEXT,
    "matchToleranceDays" INTEGER,

    CONSTRAINT "PredictionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerObservation" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "horizonBucket" INTEGER NOT NULL,
    "cohortWeek" TIMESTAMP(3) NOT NULL,
    "daysOutAtSnapshot" INTEGER NOT NULL,
    "independentSourceIds" TEXT[],
    "hadRuleAtSnapshot" BOOLEAN NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PredictionSnapshot_identity_key" ON "PredictionSnapshot"("kennelId", "predictedDate", "startTimeKey", "horizonBucket");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_outcome_predictedDate_idx" ON "PredictionSnapshot"("outcome", "predictedDate");

-- CreateIndex
CREATE INDEX "PredictionSnapshot_snapshotAt_idx" ON "PredictionSnapshot"("snapshotAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerObservation_kennelId_horizonBucket_cohortWeek_key" ON "LedgerObservation"("kennelId", "horizonBucket", "cohortWeek");

-- CreateIndex
CREATE INDEX "LedgerObservation_horizonBucket_cohortWeek_idx" ON "LedgerObservation"("horizonBucket", "cohortWeek");

-- AddForeignKey
ALTER TABLE "PredictionSnapshot" ADD CONSTRAINT "PredictionSnapshot_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerObservation" ADD CONSTRAINT "LedgerObservation_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
