-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "clerkImageUrl" TEXT,
ADD COLUMN     "hideClerkImage" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "attendanceVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PRIVATE';
