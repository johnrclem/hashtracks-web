-- CreateEnum
CREATE TYPE "AuditStream" AS ENUM ('AUTOMATED', 'CHROME_EVENT', 'CHROME_KENNEL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AuditIssueEventType" AS ENUM ('OPENED', 'CLOSED', 'REOPENED', 'RELABELED');

-- CreateTable
CREATE TABLE "AuditIssue" (
    "id" TEXT NOT NULL,
    "githubNumber" INTEGER NOT NULL,
    "stream" "AuditStream" NOT NULL,
    "state" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "htmlUrl" TEXT NOT NULL,
    "kennelCode" TEXT,
    "githubCreatedAt" TIMESTAMP(3) NOT NULL,
    "githubClosedAt" TIMESTAMP(3),
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditIssueEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "type" "AuditIssueEventType" NOT NULL,
    "stream" "AuditStream" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fromStream" "AuditStream",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditIssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditIssue_githubNumber_key" ON "AuditIssue"("githubNumber");

-- CreateIndex
CREATE INDEX "AuditIssue_stream_state_idx" ON "AuditIssue"("stream", "state");

-- CreateIndex
CREATE INDEX "AuditIssue_kennelCode_idx" ON "AuditIssue"("kennelCode");

-- CreateIndex
CREATE INDEX "AuditIssueEvent_type_occurredAt_idx" ON "AuditIssueEvent"("type", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditIssueEvent_stream_occurredAt_idx" ON "AuditIssueEvent"("stream", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditIssueEvent_issueId_occurredAt_idx" ON "AuditIssueEvent"("issueId", "occurredAt");

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_kennelCode_fkey" FOREIGN KEY ("kennelCode") REFERENCES "Kennel"("kennelCode") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssueEvent" ADD CONSTRAINT "AuditIssueEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "AuditIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
