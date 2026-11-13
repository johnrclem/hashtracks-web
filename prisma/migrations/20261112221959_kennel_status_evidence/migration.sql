-- CreateEnum
CREATE TYPE "KennelConfirmationKind" AS ENUM ('RUNNING', 'STOPPED');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isScheduleOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Kennel" ADD COLUMN     "lastConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "lastRunSeenAt" TIMESTAMP(3),
ADD COLUMN     "nextRunPostedAt" TIMESTAMP(3),
ADD COLUMN     "stoppedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "KennelConfirmation" (
    "id" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "kind" "KennelConfirmationKind" NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL,
    "url" TEXT,
    "createdById" TEXT NOT NULL,
    "disabledSourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deactivatedRuleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KennelConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KennelConfirmation_kennelId_kind_observedAt_idx" ON "KennelConfirmation"("kennelId", "kind", "observedAt");

-- AddForeignKey
ALTER TABLE "KennelConfirmation" ADD CONSTRAINT "KennelConfirmation_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KennelConfirmation" ADD CONSTRAINT "KennelConfirmation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
