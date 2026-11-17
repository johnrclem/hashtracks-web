-- Ops watchdog (ops plan S2; docs/ops/system.md): AutomationRun records each cron run,
-- authenticated agent API call and watchdog pass; AutomationState holds the watchdog's
-- alarm state per automation in src/lib/automation-registry.ts.
--
-- Additive only: two new tables and four new enums. No existing row changes, and
-- CronHeartbeat stays until backfill PR 5 merges (ops plan amendment v6, section 1).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "AutomationRunKind" AS ENUM ('CRON', 'AGENT_CALL', 'WATCHDOG');
-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
-- CreateEnum
CREATE TYPE "AutomationStatus" AS ENUM ('OK', 'OVERDUE');
-- CreateEnum
CREATE TYPE "AutomationVerdict" AS ENUM ('OK', 'BLOCKED_ON_OWNER', 'OVERDUE', 'UNKNOWN');
-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automation" TEXT NOT NULL,
    "kind" "AutomationRunKind" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "summary" TEXT,
    "metrics" JSONB,
    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "AutomationState" (
    "automation" TEXT NOT NULL,
    "status" "AutomationStatus" NOT NULL DEFAULT 'OK',
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issueNumber" INTEGER,
    "alertedAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "verdict" "AutomationVerdict",
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationState_pkey" PRIMARY KEY ("automation")
);
-- CreateIndex
CREATE INDEX "AutomationRun_automation_startedAt_idx" ON "AutomationRun"("automation", "startedAt");

COMMIT;
