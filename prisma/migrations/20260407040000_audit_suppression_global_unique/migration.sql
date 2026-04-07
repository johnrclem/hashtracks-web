-- Partial unique index: Postgres treats NULLs as distinct in regular unique
-- indexes, so @@unique([kennelCode, rule]) does not prevent duplicate global
-- suppressions (where kennelCode IS NULL). This partial index closes that gap.
--
-- Prisma's schema language can't express partial indexes, so this is a
-- hand-written migration. Prod already has this index (applied via
-- prisma/manual-sql/2026-04-05-audit-suppression-global-unique.sql) and is
-- marked applied via `prisma migrate resolve`. Fresh databases pick it up
-- on first `migrate deploy`. IF NOT EXISTS is belt-and-suspenders.
CREATE UNIQUE INDEX IF NOT EXISTS "AuditSuppression_global_rule_key"
  ON "AuditSuppression" ("rule")
  WHERE "kennelCode" IS NULL;
