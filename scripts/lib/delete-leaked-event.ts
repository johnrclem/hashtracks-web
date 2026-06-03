/**
 * One-shot HARD-delete helper for the `cleanup-*.ts` single-event leak
 * cleanups (PII, admin notices, title leaks).
 *
 * Unlike {@link cascadeDeleteEvents} in `cascade-delete.ts` (which UNLINKS
 * RawEvents and re-flags them `processed=false` for bulk admin deletes),
 * this hard-deletes the leaked RawEvent. The RawEvent.rawJson still carries
 * the verbatim source row, so resetting `processed=false` would let the
 * merge pipeline recreate the leaked Event on the next run. Hard-deleting
 * the RawEvent is what lets an adapter-side filter hold end-to-end against
 * a re-scrape. EventHare / Attendance / KennelAttendance are hard-deleted
 * too because their FKs don't cascade (per prisma/schema.prisma); EventLink
 * and EventKennel cascade automatically.
 */
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Relations a caller can require to be empty for a hard-delete to proceed.
 * The invariant is bound to the delete: each relation's `deleteMany` runs
 * inside the transaction and, for a required-empty relation, ANY row it
 * removes throws and rolls the whole transaction back.
 *
 * TOCTOU-proof under PostgreSQL's default READ COMMITTED — the `deleteMany`
 * result is the authoritative count of rows present at delete time, so no
 * separate snapshot read can race a concurrent insert (the prior
 * count-then-delete shape had that race — Codex review).
 */
export type RequireZeroCount = "hares" | "attendances" | "kennelAttendances" | "rawEvents";

/** Thrown (rolling back the transaction) when a required-empty relation removed rows at delete time. */
export class DeleteSafetyViolationError extends Error {
  constructor(
    readonly eventId: string,
    readonly violations: Partial<Record<RequireZeroCount, number>>,
  ) {
    super(
      `Refusing to delete Event ${eventId}: required-empty relation(s) had rows at delete time — ${Object.entries(
        violations,
      )
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")}`,
    );
    this.name = "DeleteSafetyViolationError";
  }
}

/**
 * Thrown (rolling back the transaction) when `forbidForeignRawSourceId` is set
 * and a RawEvent from a different source is attached to the Event at delete
 * time. Checked AFTER the FOR UPDATE lock so a concurrent merge can't slip a
 * foreign RawEvent in past the caller's provenance snapshot.
 */
export class ForeignRawSourceError extends Error {
  constructor(
    readonly eventId: string,
    readonly foreignSourceId: string | null,
  ) {
    super(
      `Refusing to delete Event ${eventId}: a RawEvent from a non-allowed source ` +
        `(${foreignSourceId ?? "unknown"}) was present at delete time.`,
    );
    this.name = "ForeignRawSourceError";
  }
}

export async function deleteLeakedEvent(
  prisma: PrismaClient,
  eventId: string,
  requireZeroCounts: RequireZeroCount[] = [],
  /**
   * When set, the delete proceeds only if every RawEvent on the Event belongs
   * to this source id (no foreign-provenance RawEvent exists). Enforced under
   * the row lock so it's race-proof — for provenance-scoped cleanups that must
   * not hard-delete an event another source has since merged onto.
   */
  forbidForeignRawSourceId?: string,
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
    // Lock the parent Event for the transaction's lifetime. A concurrent
    // scrape/merge linking a NEW child row needs FOR KEY SHARE on this row
    // (FK insert/update); FOR UPDATE conflicts, so any such writer blocks
    // until we commit or roll back. This is what makes the `rawEvents`
    // invariant trustworthy: RawEvent.eventId is a NULLABLE FK with no
    // cascade, so without the lock a RawEvent linked after `rawEvent
    // .deleteMany` would be silently SET NULL by the Event delete instead of
    // failing — bypassing the guard (Codex review). Non-nullable child FKs
    // (Attendance/KennelAttendance/EventHare) would fail the delete anyway;
    // the lock just makes the whole path uniformly race-free.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE
    `;
    if (locked.length === 0) {
      console.log(`Event ${eventId} vanished before lock — nothing to delete.`);
      return;
    }

    // Provenance guard (under the lock, before any delete): refuse if a
    // RawEvent from a different source was attached after the caller's
    // snapshot — i.e. another source has merged onto this event since.
    if (forbidForeignRawSourceId) {
      const foreign = await tx.rawEvent.findFirst({
        where: { eventId, sourceId: { not: forbidForeignRawSourceId } },
        select: { sourceId: true },
      });
      if (foreign) {
        throw new ForeignRawSourceError(eventId, foreign.sourceId);
      }
    }

    const hareDeleted = await tx.eventHare.deleteMany({ where: { eventId } });
    const attDeleted = await tx.attendance.deleteMany({ where: { eventId } });
    const kaDeleted = await tx.kennelAttendance.deleteMany({ where: { eventId } });
    const rawDeleted = await tx.rawEvent.deleteMany({ where: { eventId } });
    const ekDeleted = await tx.eventKennel.deleteMany({ where: { eventId } });

    // Each deleteMany above reported exactly how many rows existed at delete
    // time. For a required-empty relation, any nonzero count means data
    // appeared after the script's pre-flight snapshot — throw so the whole
    // transaction (including these deletes) rolls back rather than destroying it.
    if (requireZeroCounts.length > 0) {
      const deletedByRelation: Record<RequireZeroCount, number> = {
        hares: hareDeleted.count,
        attendances: attDeleted.count,
        kennelAttendances: kaDeleted.count,
        rawEvents: rawDeleted.count,
      };
      const violations: Partial<Record<RequireZeroCount, number>> = {};
      for (const key of requireZeroCounts) {
        if (deletedByRelation[key] > 0) violations[key] = deletedByRelation[key];
      }
      if (Object.keys(violations).length > 0) {
        throw new DeleteSafetyViolationError(eventId, violations);
      }
    }

    await tx.event.delete({ where: { id: eventId } });
    console.log(
      `Deleted ${hareDeleted.count} EventHare(s), ${attDeleted.count} Attendance(s), ${kaDeleted.count} KennelAttendance(s), ${rawDeleted.count} RawEvent(s), ${ekDeleted.count} EventKennel(s), and the Event itself.`,
    );
  });
  console.log("Done.");
}
