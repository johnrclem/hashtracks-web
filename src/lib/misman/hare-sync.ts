/**
 * Sync EventHare records from KennelAttendance.haredThisTrail flags.
 * Called automatically after attendance record/update mutations.
 *
 * Idempotent: safe to call multiple times for the same event.
 * Only manages MISMAN_SYNC records — never touches SCRAPED records.
 */

import { prisma } from "@/lib/db";

/**
 * Sync EventHare records for an event based on current KennelAttendance hare flags.
 *
 * 1. Finds all attendance records for the event where haredThisTrail = true
 * 2. Upserts an EventHare (MISMAN_SYNC) for each, using hasher's display name
 * 3. Removes stale MISMAN_SYNC EventHare records no longer matching any hare
 */
export async function syncEventHares(eventId: string): Promise<void> {
  // Get all hared attendance records with hasher info and user links
  const haredRecords = await prisma.kennelAttendance.findMany({
    where: { eventId, haredThisTrail: true },
    include: {
      kennelHasher: {
        select: {
          hashName: true,
          nerdName: true,
          userLink: {
            select: {
              userId: true,
              status: true,
            },
          },
        },
      },
    },
  });

  // Build the set of expected MISMAN_SYNC hare names
  const expectedHares: { hareName: string; userId: string | null }[] = [];

  for (const record of haredRecords) {
    const hareName =
      record.kennelHasher.hashName || record.kennelHasher.nerdName;
    if (!hareName) continue; // Skip hashers with no name

    const userId =
      record.kennelHasher.userLink?.status === "CONFIRMED"
        ? record.kennelHasher.userLink.userId
        : null;

    expectedHares.push({ hareName, userId });
  }

  // Upsert each expected hare
  for (const hare of expectedHares) {
    await prisma.eventHare.upsert({
      where: {
        eventId_hareName: { eventId, hareName: hare.hareName },
      },
      update: {
        userId: hare.userId,
        sourceType: "MISMAN_SYNC",
      },
      create: {
        eventId,
        hareName: hare.hareName,
        userId: hare.userId,
        sourceType: "MISMAN_SYNC",
      },
    });
  }

  // Remove stale MISMAN_SYNC records that no longer match any hare
  const expectedNames = new Set(expectedHares.map((h) => h.hareName));

  const existingSynced = await prisma.eventHare.findMany({
    where: { eventId, sourceType: "MISMAN_SYNC" },
    select: { id: true, hareName: true },
  });

  const staleIds = existingSynced
    .filter((eh) => !expectedNames.has(eh.hareName))
    .map((eh) => eh.id);

  if (staleIds.length > 0) {
    await prisma.eventHare.deleteMany({
      where: { id: { in: staleIds } },
    });
  }
}
