-- First-party, non-publishing review queue for chrome-stream audit findings.
-- The Claude-in-Chrome agent inserts PENDING drafts via /api/audit/submit-finding;
-- the /api/cron/promote-audit-findings cron promotes them to GitHub issues via the
-- shared filer. Nothing here publishes on insert.

-- CreateEnum
CREATE TYPE "AuditDraftStatus" AS ENUM ('PENDING', 'FILED', 'RECURRED', 'SUPPRESSED', 'REJECTED', 'ERROR');

-- CreateTable
CREATE TABLE "AuditFindingDraft" (
    "id" TEXT NOT NULL,
    "stream" "AuditStream" NOT NULL,
    "kennelCode" TEXT,
    "ruleSlug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bodyMarkdown" TEXT NOT NULL,
    "affectedEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentHash" TEXT NOT NULL,
    "status" "AuditDraftStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByUserId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promotedAt" TIMESTAMP(3),
    "issueNumber" INTEGER,
    "issueUrl" TEXT,
    "filerTier" TEXT,
    "errorReason" TEXT,
    "promoteAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AuditFindingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditFindingDraft_status_submittedAt_idx" ON "AuditFindingDraft"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "AuditFindingDraft_kennelCode_idx" ON "AuditFindingDraft"("kennelCode");

-- Partial unique: only one PENDING draft per identical content (same-run re-submit
-- idempotency). Once a draft leaves PENDING the hash is free again, so a finding that
-- genuinely recurs on a later day can be re-queued — the filer turns it into a recurrence
-- comment. Prisma can't express a filtered unique index, so it lives here, not in @@unique.
CREATE UNIQUE INDEX "AuditFindingDraft_pending_contentHash_key"
    ON "AuditFindingDraft"("contentHash")
    WHERE "status" = 'PENDING';

-- AddForeignKey
ALTER TABLE "AuditFindingDraft" ADD CONSTRAINT "AuditFindingDraft_kennelCode_fkey" FOREIGN KEY ("kennelCode") REFERENCES "Kennel"("kennelCode") ON DELETE SET NULL ON UPDATE CASCADE;
