BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "ConfirmationVia" AS ENUM ('ADMIN', 'HALF_MIND');

-- AlterTable
ALTER TABLE "Kennel" ADD COLUMN     "halfMindListingId" TEXT,
ADD COLUMN     "lastConfirmedVia" "ConfirmationVia",
ADD COLUMN     "listingOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KennelConfirmation" ADD COLUMN     "via" "ConfirmationVia" NOT NULL DEFAULT 'ADMIN';

-- AlterTable
ALTER TABLE "KennelDiscovery" ADD COLUMN     "externalCheckedAt" TIMESTAMP(3),
ADD COLUMN     "externalScope" TEXT,
ADD COLUMN     "externalStatus" TEXT,
ADD COLUMN     "facebookUrl" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Kennel_halfMindListingId_key" ON "Kennel"("halfMindListingId");

COMMIT;
