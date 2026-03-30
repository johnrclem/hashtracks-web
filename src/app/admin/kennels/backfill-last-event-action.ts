"use server";

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function backfillLastEventDates() {
  await getAdminUser(); // Auth guard

  // One query: MAX(date) per kennel, excluding cancelled and manual entries
  const results = await prisma.$queryRaw<{ kennelId: string; maxDate: Date }[]>`
    SELECT "kennelId", MAX(date) as "maxDate"
    FROM "Event"
    WHERE status != 'CANCELLED'
    AND "isManualEntry" != true
    AND "parentEventId" IS NULL
    GROUP BY "kennelId"
  `;

  let updated = 0;
  for (const row of results) {
    await prisma.kennel.update({
      where: { id: row.kennelId },
      data: { lastEventDate: row.maxDate },
    });
    updated++;
  }

  return { updated, total: results.length };
}
