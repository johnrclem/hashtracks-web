-- Ops plan S1: lanes in the AuditIssue mirror. The mirror now also syncs issues that carry a
-- `lane:*` label but not `audit`; `lane` records each issue's lane, and `hasAuditLabel` keeps
-- those lane-only issues out of the per-stream audit stats. Additive only: existing rows were all
-- mirrored for their `audit` label, so the default `true` is right for them, and `lane` stays
-- NULL until the next sync fills it.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "AuditIssue" ADD COLUMN "lane" TEXT,
ADD COLUMN "hasAuditLabel" BOOLEAN NOT NULL DEFAULT true;

COMMIT;
