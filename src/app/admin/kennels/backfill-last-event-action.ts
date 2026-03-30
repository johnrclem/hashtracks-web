"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function backfillLastEventDates(): Promise<{ error?: string; updated?: number }> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  // Single SQL: compute MAX(date) per kennel and update in one statement
  const result = await prisma.$executeRaw`
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

  return { updated: result };
}
