-- CreateTable
CREATE TABLE "RuleDriftSnapshot" (
    "id" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "driftCount" INTEGER NOT NULL,
    "findings" JSONB NOT NULL,

    CONSTRAINT "RuleDriftSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RuleDriftSnapshot_ranAt_idx" ON "RuleDriftSnapshot"("ranAt");
