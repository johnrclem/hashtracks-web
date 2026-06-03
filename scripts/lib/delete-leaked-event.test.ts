import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  deleteLeakedEvent,
  DeleteSafetyViolationError,
  ForeignRawSourceError,
} from "./delete-leaked-event";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * The safety invariant is bound to the deleteMany result, not a separate
 * count read, so these tests drive the helper through a fake `tx` whose
 * per-relation deleteMany counts are configurable. The whole point is the
 * TOCTOU-proofing: a required-empty relation that removes a row must throw
 * and leave `event.delete` un-called (the transaction would roll back).
 */
type RelationCounts = {
  hares?: number;
  attendances?: number;
  kennelAttendances?: number;
  rawEvents?: number;
  eventKennels?: number;
};

function buildPrisma(
  counts: RelationCounts,
  lockedRows: Array<{ id: string }> = [{ id: "evt_1" }],
  /** When set, `rawEvent.findFirst` (the foreign-provenance probe) returns this. */
  foreignRaw: { sourceId: string | null } | null = null,
) {
  const eventDelete = vi.fn().mockResolvedValue({});
  const queryRaw = vi.fn().mockResolvedValue(lockedRows);
  const tx = {
    $queryRaw: queryRaw,
    eventHare: { deleteMany: vi.fn().mockResolvedValue({ count: counts.hares ?? 0 }) },
    attendance: { deleteMany: vi.fn().mockResolvedValue({ count: counts.attendances ?? 0 }) },
    kennelAttendance: {
      deleteMany: vi.fn().mockResolvedValue({ count: counts.kennelAttendances ?? 0 }),
    },
    rawEvent: {
      deleteMany: vi.fn().mockResolvedValue({ count: counts.rawEvents ?? 0 }),
      findFirst: vi.fn().mockResolvedValue(foreignRaw),
    },
    eventKennel: { deleteMany: vi.fn().mockResolvedValue({ count: counts.eventKennels ?? 0 }) },
    event: { delete: eventDelete },
  };
  const prisma = {
    event: {
      findUnique: vi.fn().mockResolvedValue({
        id: "evt_1",
        title: "Every Wednesday @ 6:30pm from tbd",
        date: new Date("2024-06-01T12:00:00Z"),
        kennelId: "kennel_1",
        _count: { hares: 0, attendances: 0, kennelAttendances: 0 },
      }),
    },
    // Run the callback with our fake tx; propagate throws like a rollback.
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma: prisma as unknown as PrismaClient, eventDelete, queryRaw, tx };
}

describe("deleteLeakedEvent safety invariant", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("deletes the event when every required-empty relation removed zero rows", async () => {
    const { prisma, eventDelete } = buildPrisma({ rawEvents: 3 });
    await deleteLeakedEvent(prisma, "evt_1", ["hares", "attendances", "kennelAttendances"]);
    expect(eventDelete).toHaveBeenCalledTimes(1);
  });

  it("throws and never deletes the event when a required-empty relation removed a row", async () => {
    // A user RSVP landed after the script's pre-flight snapshot: the
    // attendance deleteMany now reports 1, which must abort the delete.
    const { prisma, eventDelete } = buildPrisma({ attendances: 1 });
    await expect(
      deleteLeakedEvent(prisma, "evt_1", ["hares", "attendances", "kennelAttendances"]),
    ).rejects.toBeInstanceOf(DeleteSafetyViolationError);
    expect(eventDelete).not.toHaveBeenCalled();
  });

  it("allows rawEvents to be removed when rawEvents is not a required-empty relation (re-scrape leak)", async () => {
    // mh3-mn semantics: RawEvent backing is EXPECTED and must be deleted,
    // so a nonzero rawEvents deleteMany is fine while user data stays guarded.
    const { prisma, eventDelete } = buildPrisma({ rawEvents: 1 });
    await deleteLeakedEvent(prisma, "evt_1", ["hares", "attendances", "kennelAttendances"]);
    expect(eventDelete).toHaveBeenCalledTimes(1);
  });

  it("guards rawEvents too when it is listed (mel-nm pure-orphan semantics)", async () => {
    const { prisma, eventDelete } = buildPrisma({ rawEvents: 1 });
    await expect(
      deleteLeakedEvent(prisma, "evt_1", ["hares", "attendances", "kennelAttendances", "rawEvents"]),
    ).rejects.toBeInstanceOf(DeleteSafetyViolationError);
    expect(eventDelete).not.toHaveBeenCalled();
  });

  it("deletes unconditionally when no invariant is requested (default callers)", async () => {
    const { prisma, eventDelete } = buildPrisma({ attendances: 5, rawEvents: 5 });
    await deleteLeakedEvent(prisma, "evt_1");
    expect(eventDelete).toHaveBeenCalledTimes(1);
  });

  it("takes a FOR UPDATE row lock before deleting any relation", async () => {
    const { prisma, queryRaw, tx } = buildPrisma({});
    await deleteLeakedEvent(prisma, "evt_1", ["rawEvents"]);
    const sql = String(queryRaw.mock.calls[0][0]);
    expect(sql).toContain("FOR UPDATE");
    // The lock must be acquired BEFORE any relation delete or the TOCTOU
    // guarantee is void — assert ordering, not just that the lock ran.
    expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.rawEvent.deleteMany.mock.invocationCallOrder[0],
    );
  });

  it("short-circuits without deleting when the Event vanished before the lock", async () => {
    const { prisma, eventDelete, tx } = buildPrisma({}, []);
    await deleteLeakedEvent(prisma, "evt_1", ["rawEvents"]);
    expect(eventDelete).not.toHaveBeenCalled();
    expect(tx.rawEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("throws ForeignRawSourceError (and never deletes) when a foreign-source RawEvent is present", async () => {
    // A different source merged onto the event after the caller's snapshot.
    const { prisma, eventDelete, tx } = buildPrisma({}, [{ id: "evt_1" }], { sourceId: "src_other" });
    await expect(
      deleteLeakedEvent(prisma, "evt_1", ["attendances"], "src_meetup"),
    ).rejects.toBeInstanceOf(ForeignRawSourceError);
    expect(eventDelete).not.toHaveBeenCalled();
    // The provenance probe must run under the lock, before any relation delete.
    expect(tx.rawEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.rawEvent.deleteMany).not.toHaveBeenCalled();
  });

  it("deletes when forbidForeignRawSourceId is set and no foreign RawEvent exists", async () => {
    const { prisma, eventDelete, tx } = buildPrisma({ rawEvents: 2 }, [{ id: "evt_1" }], null);
    await deleteLeakedEvent(prisma, "evt_1", ["attendances", "kennelAttendances"], "src_meetup");
    expect(tx.rawEvent.findFirst).toHaveBeenCalledTimes(1);
    expect(eventDelete).toHaveBeenCalledTimes(1);
    // The provenance probe must run before any relation delete, or a foreign
    // RawEvent could be destroyed before the guard sees it.
    expect(tx.rawEvent.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      tx.rawEvent.deleteMany.mock.invocationCallOrder[0],
    );
  });
});
