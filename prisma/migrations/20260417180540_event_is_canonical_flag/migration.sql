-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isCanonical" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Event_kennelId_date_isCanonical_idx" ON "Event"("kennelId", "date", "isCanonical");

-- RenameIndex
ALTER INDEX "ScheduleRule_kennel_rrule_source_key" RENAME TO "ScheduleRule_kennelId_rrule_source_key";

-- RenameIndex
ALTER INDEX "TravelSearch_id_userId" RENAME TO "TravelSearch_id_userId_key";
