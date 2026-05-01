-- AuditFilingNonce gets an idempotency-cache column so retries with
-- the same nonce return the original filing outcome instead of
-- burning the nonce on transient GitHub failures.

ALTER TABLE "AuditFilingNonce"
  ADD COLUMN "filingResultJson" JSONB;
