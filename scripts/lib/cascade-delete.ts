/**
 * Shared cascade-safe Event delete helper for one-shot scripts.
 *
 * Replicates the semantics of `deleteEventsCascade()` in
 * src/app/admin/events/actions.ts without the Next.js revalidation calls
 * (not available in script context):
 *   1. Unlink RawEvents (preserve immutable audit trail, reset processed=false)
 *   2. Null out parentEventId back-refs (avoid FK violations)
 *   3. Delete EventHare, Attendance, KennelAttendance rows for the events
 *   4. Delete the Event rows (EventLink cascades via onDelete: Cascade)
 *
 * Processes in batches of 100 to keep transaction sizes bounded.
 */
import type { PrismaClient } from "@/generated/prisma/client";

const BATCH_SIZE = 100;

export async function cascadeDeleteEvents(
  prisma: PrismaClient,
  eventIds: string[],
): Promise<number> {
  if (eventIds.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
    const batch = eventIds.slice(i, i + BATCH_SIZE);
    const [, , , , , eventDeleteResult] = await prisma.$transaction([
      prisma.rawEvent.updateMany({
        where: { eventId: { in: batch } },
        data: { eventId: null, processed: false },
      }),
      prisma.event.updateMany({
        where: { parentEventId: { in: batch } },
        data: { parentEventId: null },
      }),
      prisma.eventHare.deleteMany({ where: { eventId: { in: batch } } }),
      prisma.attendance.deleteMany({ where: { eventId: { in: batch } } }),
      prisma.kennelAttendance.deleteMany({ where: { eventId: { in: batch } } }),
      prisma.event.deleteMany({ where: { id: { in: batch } } }),
    ]);
    deleted += eventDeleteResult.count;
  }
  return deleted;
}
