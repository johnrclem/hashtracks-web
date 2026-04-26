import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    event: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn().mockImplementation((args: { where: { id: { in: string[] } } }) =>
        Promise.resolve({ count: args?.where?.id?.in?.length ?? 0 })
      ),
      updateMany: vi.fn(),
    },
    rawEvent: { updateMany: vi.fn() },
    eventHare: { deleteMany: vi.fn() },
    attendance: { deleteMany: vi.fn() },
    kennelAttendance: { deleteMany: vi.fn() },
    $transaction: vi.fn((arr: Promise<unknown>[]) =>
      Promise.all(arr).then((results) => results.map((r) => r ?? { count: 0 }))
    ),
  },
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  deleteEvent,
  previewBulkDelete,
  bulkDeleteEvents,
  deleteSelectedEvents,
} from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockEventFindUnique = vi.mocked(prisma.event.findUnique);
const mockEventFindMany = vi.mocked(prisma.event.findMany);
const mockEventCount = vi.mocked(prisma.event.count);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
});

describe("deleteEvent", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await deleteEvent("evt_1")).toEqual({ error: "Not authorized" });
  });

  it("returns error when event not found", async () => {
    mockEventFindUnique.mockResolvedValueOnce(null);
    expect(await deleteEvent("evt_1")).toEqual({ error: "Event not found" });
  });

  it("deletes event and returns success", async () => {
    const mockEvent = {
      id: "evt_1",
      date: new Date("2026-02-12T12:00:00Z"),
      kennel: { shortName: "BFM" },
    };
    mockEventFindUnique.mockResolvedValueOnce(mockEvent as never);

    const result = await deleteEvent("evt_1");
    expect(result).toEqual({
      success: true,
      kennelName: "BFM",
      date: "2026-02-12T12:00:00.000Z",
    });
  });

  it("runs cascade operations in transaction", async () => {
    const mockEvent = {
      id: "evt_1",
      date: new Date("2026-02-12T12:00:00Z"),
      kennel: { shortName: "BFM" },
    };
    mockEventFindUnique.mockResolvedValueOnce(mockEvent as never);

    await deleteEvent("evt_1");

    // Verify transaction was called
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const txArgs = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(txArgs).toHaveLength(6); // unlink rawEvents, null parentEventId, delete hares, delete attendance, delete kennelAttendance, delete event
  });
});

describe("previewBulkDelete", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await previewBulkDelete({ kennelId: "k1" })).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when no filters provided", async () => {
    const result = await previewBulkDelete({});
    expect(result).toEqual({ error: "At least one filter is required" });
  });

  it("returns count and sample events", async () => {
    mockEventCount.mockResolvedValueOnce(3 as never);
    mockEventFindMany.mockResolvedValueOnce([
      {
        id: "evt_1",
        date: new Date("2026-02-12T12:00:00Z"),
        title: "BFM Trail",
        kennel: { shortName: "BoH3" },
        _count: { attendances: 2 },
      },
    ] as never);

    const result = await previewBulkDelete({ kennelId: "k_boh3" });
    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.sampleEvents).toHaveLength(1);
    expect(result.sampleEvents![0].kennelName).toBe("BoH3");
    expect(result.totalAttendances).toBe(2);
  });
});

describe("bulkDeleteEvents", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await bulkDeleteEvents({ kennelId: "k1" })).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when no filters provided", async () => {
    const result = await bulkDeleteEvents({});
    expect(result).toEqual({ error: "At least one filter is required" });
  });

  it("returns 0 when no events match", async () => {
    mockEventFindMany.mockResolvedValueOnce([] as never);
    const result = await bulkDeleteEvents({ kennelId: "k1" });
    expect(result).toEqual({ success: true, deletedCount: 0 });
  });

  it("deletes matching events in transaction", async () => {
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1" },
      { id: "evt_2" },
    ] as never);

    const result = await bulkDeleteEvents({ kennelId: "k_boh3" });
    expect(result).toEqual({ success: true, deletedCount: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("supports sourceId filter", async () => {
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_1" }] as never);

    const result = await bulkDeleteEvents({ sourceId: "src_philly" });
    expect(result).toEqual({ success: true, deletedCount: 1 });
  });

  it("supports date range filter", async () => {
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_1" },
      { id: "evt_2" },
      { id: "evt_3" },
    ] as never);

    const result = await bulkDeleteEvents({
      dateStart: "2026-02-01",
      dateEnd: "2026-02-28",
    });
    expect(result).toEqual({ success: true, deletedCount: 3 });
  });

  it("supports 'no source' filter", async () => {
    mockEventFindMany.mockResolvedValueOnce([
      { id: "evt_orphan_1" },
      { id: "evt_orphan_2" },
    ] as never);

    const result = await bulkDeleteEvents({ sourceId: "none" });
    expect(result).toEqual({ success: true, deletedCount: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("batches large deletes into chunks of 100", async () => {
    const events = Array.from({ length: 250 }, (_, i) => ({ id: `evt_${i}` }));
    mockEventFindMany.mockResolvedValueOnce(events as never);

    const result = await bulkDeleteEvents({ kennelId: "k1" });
    expect(result).toEqual({ success: true, deletedCount: 250 });
    // 250 events / 100 per batch = 3 transaction calls
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it("returns error when too many events to delete", async () => {
    const events = Array.from({ length: 5001 }, (_, i) => ({ id: `evt_${i}` }));
    mockEventFindMany.mockResolvedValueOnce(events as never);

    const result = await bulkDeleteEvents({ kennelId: "k1" });
    expect(result).toEqual({ error: "Too many events to delete (5001). Max 5000 per bulk operation." });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns error with message on transaction failure", async () => {
    mockEventFindMany.mockResolvedValueOnce([{ id: "evt_1" }] as never);
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new Error("connection timeout"));

    const result = await bulkDeleteEvents({ kennelId: "k1" });
    expect(result.success).toBeUndefined();
    expect((result as { error: string }).error).toContain("Delete failed");
    expect((result as { error: string }).error).toContain("connection timeout");
  });
});

describe("deleteSelectedEvents", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    const result = await deleteSelectedEvents(["evt_1"]);
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("returns 0 when empty array provided", async () => {
    const result = await deleteSelectedEvents([]);
    expect(result).toEqual({ success: true, deletedCount: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns error when more than 1000 IDs provided", async () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `evt_${i}`);
    const result = await deleteSelectedEvents(ids);
    expect(result).toEqual({ error: "Too many events selected (max 1000)" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("deletes selected events in transaction", async () => {
    const result = await deleteSelectedEvents(["evt_1", "evt_2", "evt_3"]);
    expect(result).toEqual({ success: true, deletedCount: 3 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const txArgs = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(txArgs).toHaveLength(6); // unlink rawEvents, null parentEventId, delete hares, delete attendance, delete kennelAttendance, delete events
  });

  it("unlinks raw events, nulls parentEventId, and deletes dependents before events", async () => {
    await deleteSelectedEvents(["evt_1"]);

    expect(prisma.rawEvent.updateMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["evt_1"] } },
      data: { eventId: null, processed: false },
    });
    expect(prisma.event.updateMany).toHaveBeenCalledWith({
      where: { parentEventId: { in: ["evt_1"] } },
      data: { parentEventId: null },
    });
    expect(prisma.eventHare.deleteMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["evt_1"] } },
    });
    expect(prisma.attendance.deleteMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["evt_1"] } },
    });
    expect(prisma.kennelAttendance.deleteMany).toHaveBeenCalledWith({
      where: { eventId: { in: ["evt_1"] } },
    });
    expect(prisma.event.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["evt_1"] } },
    });
  });
});
