/**
 * One-shot hard-delete helper for the `cleanup-issue-NNNN.ts` family
 * (single-event leak cleanups — PII, admin notices, title leaks).
 *
 * Distinct from {@link cascadeDeleteEvents} in `cascade-delete.ts`, which
 * UNLINKS RawEvents (preserves the immutable audit trail) and re-flags
 * them as `processed=false`. That's the right shape for bulk admin
 * deletes; it's the WRONG shape for these one-shot leaks, because the
 * RawEvent.rawJson still carries the verbatim source row that produced
 * the leak. Resetting `processed=false` would let the merge pipeline
 * recreate the canonical Event on the next run.
 *
 * For an adapter-side filter (e.g. PERSONAL_TITLE_PATTERNS) to be
 * effective end-to-end, we have to also hard-delete the leaked RawEvent
 * so a re-scrape can't resurrect it. EventHare / Attendance /
 * KennelAttendance are also hard-deleted because their FKs don't
 * cascade (verified against prisma/schema.prisma); EventLink and
 * EventKennel do cascade automatically.
 */
import type { PrismaClient } from "@/generated/prisma/client";

export async function deleteLeakedEvent(
  prisma: PrismaClient,
  eventId: string,
): Promise<void> {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      date: true,
      kennelId: true,
      _count: { select: { hares: true, attendances: true, kennelAttendances: true } },
    },
  });
  if (!existing) {
    console.log(`Event ${eventId} already gone — nothing to do.`);
    return;
  }
  console.log(`Found: ${existing.title} on ${existing.date.toISOString()} (kennel ${existing.kennelId})`);
  console.log(
    `  related rows: ${existing._count.hares} EventHare, ${existing._count.attendances} Attendance, ${existing._count.kennelAttendances} KennelAttendance`,
  );

  await prisma.$transaction(async (tx) => {
    const hareDeleted = await tx.eventHare.deleteMany({ where: { eventId } });
    const attDeleted = await tx.attendance.deleteMany({ where: { eventId } });
    const kaDeleted = await tx.kennelAttendance.deleteMany({ where: { eventId } });
    const rawDeleted = await tx.rawEvent.deleteMany({ where: { eventId } });
    const ekDeleted = await tx.eventKennel.deleteMany({ where: { eventId } });
    await tx.event.delete({ where: { id: eventId } });
    console.log(
      `Deleted ${hareDeleted.count} EventHare(s), ${attDeleted.count} Attendance(s), ${kaDeleted.count} KennelAttendance(s), ${rawDeleted.count} RawEvent(s), ${ekDeleted.count} EventKennel(s), and the Event itself.`,
    );
  });
  console.log("Done.");
}
