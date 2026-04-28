import type { Prisma, Event } from "@/generated/prisma/client";

/**
 * Scalars + non-EventKennel relations only. The helper *owns* the
 * `eventKennels` write — accepting it from callers would let a future caller
 * smuggle extra primary rows that bypass the helper's invariant.
 */
type EventCreateScalars = Omit<
  Prisma.EventUncheckedCreateInput,
  | "eventKennels"
  | "attendances"
  | "rawEvents"
  | "hares"
  | "eventLinks"
  | "kennelAttendances"
  | "childEvents"
>;

/**
 * Create an Event and its primary EventKennel row in a single Prisma call
 * (issue #1023, step 2). Uses a nested write so the two inserts share one
 * round-trip and Prisma wraps them in an implicit transaction — atomicity
 * without an explicit `$transaction(...)` block.
 *
 * Pass the top-level `prisma` client for standalone calls, or a transactional
 * `tx` when this needs to share a transaction with surrounding writes (e.g.
 * the logbook manual-entry flow that also creates an Attendance row).
 *
 * The partial unique index `EventKennel(eventId) WHERE isPrimary = true`
 * enforces the single-primary invariant at the DB level — no race window
 * where an event could exist without a primary EventKennel row.
 */
export async function createEventWithKennel(
  client: Prisma.TransactionClient,
  data: EventCreateScalars,
): Promise<Event> {
  return client.event.create({
    data: {
      ...data,
      eventKennels: {
        create: { kennelId: data.kennelId, isPrimary: true },
      },
    },
  });
}
