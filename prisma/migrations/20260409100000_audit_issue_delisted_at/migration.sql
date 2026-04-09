-- AlterTable
ALTER TABLE "AuditIssue" ADD COLUMN "delistedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AuditIssue_delistedAt_idx" ON "AuditIssue"("delistedAt");
