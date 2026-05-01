import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => {
  const eventMock = {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn().mockImplementation((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve({ count: args?.where?.id?.in?.length ?? 0 })
    ),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const prismaMock = {
    event: eventMock,
    rawEvent: { updateMany: vi.fn() },
    eventHare: { deleteMany: vi.fn() },
    attendance: { deleteMany: vi.fn() },
    kennelAttendance: { deleteMany: vi.fn() },
    $executeRaw: vi.fn().mockResolvedValue(1),
    // $transaction supports both forms:
    //   - array: deleteEventsCascade pattern
    //   - callback (interactive tx): adminCancelEvent / uncancelEvent pattern
    $transaction: vi.fn(async (
      arg: Promise<unknown>[] | ((tx: typeof prismaMock) => Promise<unknown>),
    ) => {
      if (typeof arg === "function") {
        return arg(prismaMock);
      }
      const results = await Promise.all(arg);
      return results.map((r) => r ?? { count: 0 });
    }),
  };
  return { prisma: prismaMock };
});
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
  uncancelEvent,
  adminCancelEvent,
} from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockEventFindUnique = vi.mocked(prisma.event.findUnique);
const mockEventFindMany = vi.mocked(prisma.event.findMany);
const mockEventCount = vi.mocked(prisma.event.count);
const mockEventUpdate = vi.mocked(prisma.event.update);

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

describe("adminCancelEvent", () => {
  const eventBase = {
    id: "evt_1",
    kennelId: "knl_1",
    date: new Date("2026-06-06T12:00:00Z"),
    status: "CONFIRMED" as const,
    adminCancelledAt: null,
    adminCancelledBy: null,
    adminCancellationReason: null,
    adminAuditLog: null,
    kennel: { shortName: "NYCH3", slug: "nych3" },
  };

  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await adminCancelEvent("evt_1", "any reason")).toEqual({ error: "Not authorized" });
  });

  it("rejects reason shorter than 3 chars after trim", async () => {
    expect(await adminCancelEvent("evt_1", "  ab  ")).toEqual({
      error: "Reason must be at least 3 characters",
    });
  });

  it("rejects reason longer than 500 chars", async () => {
    expect(await adminCancelEvent("evt_1", "x".repeat(501))).toEqual({
      error: "Reason must be 500 characters or fewer",
    });
  });

  it("rejects unknown event", async () => {
    mockEventFindUnique.mockResolvedValueOnce(null);
    expect(await adminCancelEvent("evt_missing", "valid reason")).toEqual({
      error: "Event not found",
    });
  });

  it("rejects already admin-cancelled event", async () => {
    mockEventFindUnique.mockResolvedValueOnce({
      ...eventBase,
      status: "CANCELLED",
      adminCancelledAt: new Date("2026-05-01T10:00:00Z"),
    } as never);
    expect(await adminCancelEvent("evt_1", "different reason")).toEqual({
      error: "Event already admin-cancelled — un-cancel first to change reason",
    });
  });

  it("rejects reconciler-cancelled event (status=CANCELLED but no admin lock)", async () => {
    mockEventFindUnique.mockResolvedValueOnce({
      ...eventBase,
      status: "CANCELLED",
      adminCancelledAt: null,
    } as never);
    expect(await adminCancelEvent("evt_1", "valid reason")).toEqual({
      error: "Event is already cancelled — un-cancel first to admin-lock it",
    });
  });

  it("happy path: sets all 4 fields, appends audit entry, calls revalidations", async () => {
    mockEventFindUnique.mockResolvedValueOnce(eventBase as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await adminCancelEvent("evt_1", "  City bridge run  ");

    expect(result).toMatchObject({ success: true, kennelName: "NYCH3" });
    expect(mockEventUpdate).toHaveBeenCalledTimes(1);
    const updateArg = mockEventUpdate.mock.calls[0]?.[0] as {
      where: { id: string };
      data: {
        status: "CANCELLED";
        adminCancelledAt: Date;
        adminCancelledBy: string;
        adminCancellationReason: string;
        adminAuditLog: unknown;
      };
    };
    expect(updateArg.where).toEqual({ id: "evt_1" });
    expect(updateArg.data.status).toBe("CANCELLED");
    expect(updateArg.data.adminCancelledBy).toBe("clerk_admin");
    expect(updateArg.data.adminCancellationReason).toBe("City bridge run"); // trimmed
    expect(updateArg.data.adminCancelledAt).toBeInstanceOf(Date);
    expect(Array.isArray(updateArg.data.adminAuditLog)).toBe(true);
    const log = updateArg.data.adminAuditLog as Array<{
      action: string;
      userId: string;
      changes?: { status?: { old: string; new: string } };
      details?: { reason?: string };
    }>;
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("cancel");
    expect(log[0].userId).toBe("clerk_admin");
    expect(log[0].changes?.status).toEqual({ old: "CONFIRMED", new: "CANCELLED" });
    expect(log[0].details?.reason).toBe("City bridge run");
  });

  it("appends to existing audit log on subsequent cancel cycles", async () => {
    const priorLog = [
      {
        action: "cancel",
        timestamp: "2026-04-01T10:00:00.000Z",
        userId: "admin_1",
        changes: { status: { old: "CONFIRMED", new: "CANCELLED" } },
        details: { reason: "Old reason" },
      },
      {
        action: "uncancel",
        timestamp: "2026-04-02T10:00:00.000Z",
        userId: "admin_1",
        changes: { status: { old: "CANCELLED", new: "CONFIRMED" } },
      },
    ];
    mockEventFindUnique.mockResolvedValueOnce({
      ...eventBase,
      adminCancelledAt: null, // un-cancelled, ready to be re-cancelled
      adminAuditLog: priorLog,
    } as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await adminCancelEvent("evt_1", "New reason");
    expect(result).toMatchObject({ success: true });
    const updateArg = mockEventUpdate.mock.calls[0]?.[0] as unknown as {
      data: { adminAuditLog: Array<{ action: string }> };
    };
    expect(updateArg.data.adminAuditLog).toHaveLength(3);
    expect(updateArg.data.adminAuditLog[2].action).toBe("cancel");
  });
});

describe("uncancelEvent — extended for admin override", () => {
  const baseAdminCancelled = {
    id: "evt_1",
    kennelId: "knl_1",
    date: new Date("2026-06-06T12:00:00Z"),
    status: "CANCELLED" as const,
    adminCancelledAt: new Date("2026-05-01T10:00:00Z"),
    adminCancelledBy: "admin_1",
    adminCancellationReason: "City bridge run",
    adminAuditLog: [
      {
        action: "cancel",
        timestamp: "2026-05-01T10:00:00.000Z",
        userId: "admin_1",
        changes: { status: { old: "CONFIRMED", new: "CANCELLED" } },
        details: { reason: "City bridge run" },
      },
    ],
    kennel: { shortName: "NYCH3", slug: "nych3" },
  };

  it("clears all 3 admin-override fields and appends an uncancel audit entry on admin-cancelled rows", async () => {
    mockEventFindUnique.mockResolvedValueOnce(baseAdminCancelled as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await uncancelEvent("evt_1");

    expect(result).toMatchObject({ success: true, kennelName: "NYCH3" });
    const updateArg = mockEventUpdate.mock.calls[0]?.[0] as {
      data: {
        status: "CONFIRMED";
        adminCancelledAt: null;
        adminCancelledBy: null;
        adminCancellationReason: null;
        adminAuditLog?: Array<{ action: string }>;
      };
    };
    expect(updateArg.data.status).toBe("CONFIRMED");
    expect(updateArg.data.adminCancelledAt).toBeNull();
    expect(updateArg.data.adminCancelledBy).toBeNull();
    expect(updateArg.data.adminCancellationReason).toBeNull();
    expect(updateArg.data.adminAuditLog).toHaveLength(2);
    expect(updateArg.data.adminAuditLog?.[1].action).toBe("uncancel");
  });

  it("works on a reconciler-cancelled event (no admin lock fields, no audit append)", async () => {
    mockEventFindUnique.mockResolvedValueOnce({
      id: "evt_2",
      kennelId: "knl_1",
      date: new Date("2026-06-06T12:00:00Z"),
      status: "CANCELLED" as const,
      adminCancelledAt: null, // reconciler-cancelled
      adminCancelledBy: null,
      adminCancellationReason: null,
      adminAuditLog: null,
      kennel: { shortName: "NYCH3", slug: "nych3" },
    } as never);
    mockEventUpdate.mockResolvedValueOnce({} as never);

    const result = await uncancelEvent("evt_2");

    expect(result).toMatchObject({ success: true });
    const updateArg = mockEventUpdate.mock.calls[0]?.[0] as {
      data: { status: "CONFIRMED"; adminAuditLog?: unknown };
    };
    expect(updateArg.data.status).toBe("CONFIRMED");
    // No audit log field set when nothing to append
    expect(updateArg.data.adminAuditLog).toBeUndefined();
  });

  it("returns error when event is not cancelled", async () => {
    mockEventFindUnique.mockResolvedValueOnce({
      ...baseAdminCancelled,
      status: "CONFIRMED" as const,
    } as never);
    expect(await uncancelEvent("evt_1")).toEqual({ error: "Event is not cancelled" });
  });

  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await uncancelEvent("evt_1")).toEqual({ error: "Not authorized" });
  });

  it("returns error when event not found", async () => {
    mockEventFindUnique.mockResolvedValueOnce(null);
    expect(await uncancelEvent("evt_missing")).toEqual({ error: "Event not found" });
  });
});
