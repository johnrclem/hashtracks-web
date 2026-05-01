-- AuditIssue: fingerprint-based dedup columns + GitHub close reason.
-- Columns added here but not yet wired into runtime dedup decisions —
-- the file-finding endpoint, bridging tier, and recurrence escalation
-- logic that read/write these fields land in follow-up PRs.

ALTER TABLE "AuditIssue"
  ADD COLUMN "closeReason" TEXT,
  ADD COLUMN "fingerprint" TEXT,
  ADD COLUMN "affectedEventIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "recurrenceCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "escalatedAt" TIMESTAMP(3),
  ADD COLUMN "escalatedToIssueNumber" INTEGER;

CREATE INDEX "AuditIssue_fingerprint_idx" ON "AuditIssue"("fingerprint");

-- AuditFilingNonce: payload-bound single-use nonces for chrome filing.
CREATE TABLE "AuditFilingNonce" (
  "id" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "kennelCode" TEXT NOT NULL,
  "ruleSlug" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditFilingNonce_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditFilingNonce_nonceHash_key" ON "AuditFilingNonce"("nonceHash");
CREATE INDEX "AuditFilingNonce_adminUserId_expiresAt_idx" ON "AuditFilingNonce"("adminUserId", "expiresAt");

-- AuditRuleVersionHistory: tracks (ruleVersion, semanticHash) timeline
-- per rule. The bridging tier reads this to decide whether to merge
-- legacy null-fingerprint rows into a new finding's history.
CREATE TABLE "AuditRuleVersionHistory" (
  "id" TEXT NOT NULL,
  "ruleSlug" TEXT NOT NULL,
  "ruleVersion" INTEGER NOT NULL,
  "semanticHash" TEXT NOT NULL,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditRuleVersionHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuditRuleVersionHistory_ruleSlug_ruleVersion_key" ON "AuditRuleVersionHistory"("ruleSlug", "ruleVersion");
CREATE INDEX "AuditRuleVersionHistory_ruleSlug_validFrom_idx" ON "AuditRuleVersionHistory"("ruleSlug", "validFrom");
