-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "adminAuditLog" JSONB,
ADD COLUMN     "adminCancellationReason" TEXT,
ADD COLUMN     "adminCancelledAt" TIMESTAMP(3),
ADD COLUMN     "adminCancelledBy" TEXT;
