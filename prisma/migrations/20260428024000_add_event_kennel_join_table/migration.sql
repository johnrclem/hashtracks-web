-- CreateTable
CREATE TABLE "EventKennel" (
    "eventId" TEXT NOT NULL,
    "kennelId" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "EventKennel_pkey" PRIMARY KEY ("eventId","kennelId")
);

-- CreateIndex
CREATE INDEX "EventKennel_kennelId_idx" ON "EventKennel"("kennelId");

-- AddForeignKey
ALTER TABLE "EventKennel" ADD CONSTRAINT "EventKennel_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventKennel" ADD CONSTRAINT "EventKennel_kennelId_fkey" FOREIGN KEY ("kennelId") REFERENCES "Kennel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
