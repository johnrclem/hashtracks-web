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
      SELECT k2.id AS "kennelId", MAX(e.date) AS "maxDate"
      FROM "Kennel" k2
      LEFT JOIN "Event" e ON e."kennelId" = k2.id
        AND e.status != 'CANCELLED'
        AND e."isManualEntry" != true
      GROUP BY k2.id
    ) sub
    WHERE k.id = sub."kennelId"
    AND k."lastEventDate" IS DISTINCT FROM sub."maxDate"
  `;
}
