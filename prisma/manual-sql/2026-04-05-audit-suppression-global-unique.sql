-- Apply manually after `prisma db push` for PR #459.
-- Prisma's @@unique([kennelCode, rule]) does not enforce uniqueness when kennelCode IS NULL,
-- so global suppressions (kennelCode = NULL) can be duplicated. This partial unique index closes the gap.
-- Also drops the redundant `date` column from AuditLog (createdAt covers it).

CREATE UNIQUE INDEX IF NOT EXISTS "AuditSuppression_global_rule_key"
  ON "AuditSuppression" ("rule")
  WHERE "kennelCode" IS NULL;

ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "date";
