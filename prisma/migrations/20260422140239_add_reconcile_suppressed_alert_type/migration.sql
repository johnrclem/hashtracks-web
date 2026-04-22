-- AlterEnum
-- IF NOT EXISTS keeps deploy idempotent when the enum value is already present
-- (e.g. hand-applied on a staging DB or a partially-replayed history).
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'RECONCILE_SUPPRESSED';
