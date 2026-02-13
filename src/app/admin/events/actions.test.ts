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
      deleteMany: vi.fn(),
    },
    rawEvent: { updateMany: vi.fn() },
    eventHare: { deleteMany: vi.fn() },
    attendance: { deleteMany: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { deleteEvent, previewBulkDelete, bulkDeleteEvents } from "./actions";

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
    const txArgs = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown[];
    expect(txArgs).toHaveLength(4); // unlink rawEvents, delete hares, delete attendance, delete event
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
});
