-- Onboarding backfill automation, Phase 0 schema
-- (docs/onboarding-backfill-automation-design.md, sections 6.5, 10.3 and 11.1).
--
-- Adds the archive-source flag, the kennel archive cutoff, the backfill run
-- record and its items, the cron heartbeat and the step-up nonce. Nothing
-- reads or writes these yet; BACKFILL_AUTOMATION stays off.
--
-- Two constraints Prisma's schema language can't express are hand-written at
-- the end: the CHECK that an archive source is never enabled, and the partial
-- unique index that allows one non-PREVIEW run per approved manifest.
--
-- No existing row changes: archiveOnly defaults to false on every source, so
-- the CHECK holds for all of them.
BEGIN;
SET LOCAL lock_timeout = '5s';


-- CreateEnum
CREATE TYPE "BackfillRunStatus" AS ENUM ('PREVIEW', 'WAITING', 'BLOCKED', 'PLANNED', 'ADOPTED', 'APPLYING', 'HALTED', 'APPLIED', 'VERIFIED', 'VERIFY_FAILED', 'UNDOING', 'UNDONE');

-- CreateEnum
CREATE TYPE "BackfillBinding" AS ENUM ('ARCHIVE_SOURCE', 'ADOPT_ONLY');

-- CreateEnum
CREATE TYPE "BackfillItemOutcome" AS ENUM ('CREATED', 'LIVE_OWNED', 'ADOPTED');

-- CreateEnum
CREATE TYPE "BackfillUndoOutcome" AS ENUM ('DELETED', 'KEPT');

-- CreateEnum
CREATE TYPE "BackfillStepUpAction" AS ENUM ('RESUME', 'UNDO', 'SET_CUTOFF', 'CLEAR_CUTOFF', 'PROBE');

-- AlterTable
ALTER TABLE "Kennel" ADD COLUMN     "archiveCutoffDate" TIMESTAMP(3),
ADD COLUMN     "archiveCutoffRunId" TEXT;

-- AlterTable
ALTER TABLE "Source" ADD COLUMN     "archiveOnly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BackfillRun" (
    "id" TEXT NOT NULL,
    "prNumber" INTEGER NOT NULL,
    "mergeSha" TEXT,
    "stampedSha" TEXT,
    "mergedHeadSha" TEXT,
    "manifestPath" TEXT NOT NULL,
    "manifestSha256" TEXT NOT NULL,
    "archiveSha256" TEXT NOT NULL,
    "approvalHash" TEXT NOT NULL,
    "binding" "BackfillBinding" NOT NULL,
    "planHash" TEXT,
    "archiveSourceId" TEXT,
    "originSourceId" TEXT,
    "kennelId" TEXT,
    "splitDate" TIMESTAMP(3),
    "status" "BackfillRunStatus" NOT NULL,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "counts" JSONB,
    "plan" JSONB,
    "v3SnapshotHash" TEXT,
    "plannedOnSha" TEXT,
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "inFlightBatch" JSONB,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "cutoffSetAt" TIMESTAMP(3),
    "batchLog" JSONB NOT NULL DEFAULT '[]',
    "stepLog" JSONB NOT NULL DEFAULT '[]',
    "statusLines" JSONB,
    "verification" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "undoPlan" JSONB,
    "undoPlanHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackfillRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackfillRunItem" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "outcome" "BackfillItemOutcome" NOT NULL,
    "fingerprint" TEXT,
    "rawEventId" TEXT,
    "eventId" TEXT,
    "batchIndex" INTEGER,
    "undoneAt" TIMESTAMP(3),
    "undoOutcome" "BackfillUndoOutcome",
    "undoReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackfillRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CronHeartbeat" (
    "jobName" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastResult" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CronHeartbeat_pkey" PRIMARY KEY ("jobName")
);

-- CreateTable
CREATE TABLE "BackfillStepUpNonce" (
    "id" TEXT NOT NULL,
    "nonceHash" TEXT NOT NULL,
    "clerkSessionId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "action" "BackfillStepUpAction" NOT NULL,
    "runId" TEXT,
    "kennelId" TEXT,
    "payloadHash" TEXT,
    "mintChecks" JSONB,
    "useChecks" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackfillStepUpNonce_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BackfillRun_status_idx" ON "BackfillRun"("status");

-- CreateIndex
CREATE INDEX "BackfillRun_kennelId_idx" ON "BackfillRun"("kennelId");

-- CreateIndex
CREATE INDEX "BackfillRun_prNumber_idx" ON "BackfillRun"("prNumber");

-- CreateIndex
CREATE INDEX "BackfillRunItem_eventId_idx" ON "BackfillRunItem"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillRunItem_runId_rowIndex_key" ON "BackfillRunItem"("runId", "rowIndex");

-- CreateIndex
CREATE UNIQUE INDEX "BackfillStepUpNonce_nonceHash_key" ON "BackfillStepUpNonce"("nonceHash");

-- CreateIndex
CREATE INDEX "BackfillStepUpNonce_clerkSessionId_idx" ON "BackfillStepUpNonce"("clerkSessionId");

-- AddForeignKey
ALTER TABLE "Kennel" ADD CONSTRAINT "Kennel_archiveCutoffRunId_fkey" FOREIGN KEY ("archiveCutoffRunId") REFERENCES "BackfillRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_archiveSourceId_fkey" FOREIGN KEY ("archiveSourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_originSourceId_fkey" FOREIGN KEY ("originSourceId") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRun" ADD CONSTRAINT "BackfillRun_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackfillRunItem" ADD CONSTRAINT "BackfillRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BackfillRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An archive source is never enabled (design 6.5): enabling it would hand it to
-- the scrape dispatcher and name it as the kennel's live feed. Applies to every
-- writer: admin actions, the seed and migrations alike.
ALTER TABLE "Source" ADD CONSTRAINT "Source_archiveOnly_not_enabled"
  CHECK (NOT ("archiveOnly" AND "enabled"));

-- One run per approved manifest, for every status except PREVIEW (design 6.7, A5):
-- a blocked or undone manifest can't be planned again.
CREATE UNIQUE INDEX "BackfillRun_manifestSha256_nonpreview_key"
  ON "BackfillRun" ("manifestSha256")
  WHERE "status" <> 'PREVIEW';

COMMIT;
