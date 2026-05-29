/**
 * Shared slot-safe Event→kennel reassignment helper for one-shot cleanup
 * scripts. Extracted so cross-kennel conflation fixers don't each carry their
 * own copy of the EventKennel composite-PK-safe transaction (the subtle part
 * is the co-host collision case).
 */

import type { PrismaClient } from "@/generated/prisma/client";

/** UTC day window [start, nextDay) for an ISO `YYYY-MM-DD` date. */
export function utcDayBounds(isoDate: string): { day: Date; next: Date } {
  const day = new Date(`${isoDate}T00:00:00.000Z`);
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + 1);
  return { day, next };
}

/**
 * Reassign an Event from one primary kennel to another in a single transaction,
 * keeping the unique `(eventId, kennelId)` constraint on EventKennel safe. If
 * the target kennel already has an EventKennel row on this event (legitimate
 * co-host link), drop the source row instead of an update that would collide on
 * the composite primary key, then promote the surviving row to primary.
 */
export async function reassignEventKennel(
  prisma: PrismaClient,
  eventId: string,
  fromKennelId: string,
  toKennelId: string,
): Promise<void> {
  const targetCoHost = await prisma.eventKennel.findUnique({
    where: { eventId_kennelId: { eventId, kennelId: toKennelId } },
  });
  await prisma.$transaction([
    prisma.event.update({ where: { id: eventId }, data: { kennelId: toKennelId } }),
    targetCoHost
      ? prisma.eventKennel.delete({ where: { eventId_kennelId: { eventId, kennelId: fromKennelId } } })
      : prisma.eventKennel.updateMany({
          where: { eventId, kennelId: fromKennelId },
          data: { kennelId: toKennelId },
        }),
  ]);
  if (targetCoHost && !targetCoHost.isPrimary) {
    await prisma.eventKennel.update({
      where: { eventId_kennelId: { eventId, kennelId: toKennelId } },
      data: { isPrimary: true },
    });
  }
}
