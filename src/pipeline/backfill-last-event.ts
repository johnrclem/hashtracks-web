import { prisma } from "@/lib/db";

/**
 * Backfill `lastEventDate` for all kennels by computing MAX(date) from their events.
 * Returns the number of kennel rows updated.
 *
 * Called from:
 * - Admin action (manual trigger with auth)
 * - Audit cron (daily, ensures cache stays populated)
 */
export async function backfillLastEventDates(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Kennel" k
    SET "lastEventDate" = sub."maxDate", "updatedAt" = NOW()
    FROM (
      SELECT "kennelId", MAX(date) as "maxDate"
      FROM "Event"
      WHERE status != 'CANCELLED'
      AND "isManualEntry" != true
      GROUP BY "kennelId"
    ) sub
    WHERE k.id = sub."kennelId"
    AND (k."lastEventDate" IS NULL OR k."lastEventDate" != sub."maxDate")
  `;
}
