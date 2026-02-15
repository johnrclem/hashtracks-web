import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncEventHares } from "./hare-sync";

vi.mock("@/lib/db", () => ({
  prisma: {
    kennelAttendance: {
      findMany: vi.fn(),
    },
    eventHare: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";

const mockFindManyAttendance = vi.mocked(prisma.kennelAttendance.findMany);
const mockUpsertHare = vi.mocked(prisma.eventHare.upsert);
const mockFindManyHare = vi.mocked(prisma.eventHare.findMany);
const mockDeleteManyHare = vi.mocked(prisma.eventHare.deleteMany);

beforeEach(() => {
  vi.clearAllMocks();
  mockFindManyHare.mockResolvedValue([] as never);
  mockDeleteManyHare.mockResolvedValue({ count: 0 } as never);
  mockUpsertHare.mockResolvedValue({} as never);
});

describe("syncEventHares", () => {
  it("creates EventHare when hasher flagged as hare", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: "Mudflap",
          nerdName: "John Doe",
          userLink: null,
        },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).toHaveBeenCalledWith({
      where: { eventId_hareName: { eventId: "event_1", hareName: "Mudflap" } },
      update: { userId: null, sourceType: "MISMAN_SYNC" },
      create: {
        eventId: "event_1",
        hareName: "Mudflap",
        userId: null,
        sourceType: "MISMAN_SYNC",
      },
    });
  });

  it("sets userId when KennelHasher has confirmed link", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: "Mudflap",
          nerdName: "John Doe",
          userLink: { userId: "user_1", status: "CONFIRMED" },
        },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { userId: "user_1", sourceType: "MISMAN_SYNC" },
        create: expect.objectContaining({ userId: "user_1" }),
      }),
    );
  });

  it("does not set userId for SUGGESTED links", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: "Mudflap",
          nerdName: null,
          userLink: { userId: "user_1", status: "SUGGESTED" },
        },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { userId: null, sourceType: "MISMAN_SYNC" },
      }),
    );
  });

  it("uses hashName as hareName, falls back to nerdName", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: null,
          nerdName: "Jane Smith",
          userLink: null,
        },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId_hareName: { eventId: "event_1", hareName: "Jane Smith" } },
      }),
    );
  });

  it("skips hashers with no name", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: null,
          nerdName: null,
          userLink: null,
        },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).not.toHaveBeenCalled();
  });

  it("removes stale MISMAN_SYNC EventHare records", async () => {
    mockFindManyAttendance.mockResolvedValue([] as never);
    mockFindManyHare.mockResolvedValue([
      { id: "eh_stale", hareName: "Old Hare" },
    ] as never);

    await syncEventHares("event_1");

    expect(mockDeleteManyHare).toHaveBeenCalledWith({
      where: { id: { in: ["eh_stale"] } },
    });
  });

  it("does not remove current hare records", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: {
          hashName: "Mudflap",
          nerdName: null,
          userLink: null,
        },
      },
    ] as never);
    mockFindManyHare.mockResolvedValue([
      { id: "eh_1", hareName: "Mudflap" },
    ] as never);

    await syncEventHares("event_1");

    // deleteMany should not be called since there are no stale records
    expect(mockDeleteManyHare).not.toHaveBeenCalled();
  });

  it("handles multiple hares per event", async () => {
    mockFindManyAttendance.mockResolvedValue([
      {
        kennelHasher: { hashName: "Mudflap", nerdName: null, userLink: null },
      },
      {
        kennelHasher: { hashName: "Trail Blazer", nerdName: null, userLink: null },
      },
    ] as never);

    await syncEventHares("event_1");

    expect(mockUpsertHare).toHaveBeenCalledTimes(2);
  });

  it("is idempotent — calling twice produces same result", async () => {
    const attendance = [
      {
        kennelHasher: { hashName: "Mudflap", nerdName: null, userLink: null },
      },
    ];
    mockFindManyAttendance.mockResolvedValue(attendance as never);
    mockFindManyHare.mockResolvedValue([
      { id: "eh_1", hareName: "Mudflap" },
    ] as never);

    await syncEventHares("event_1");
    await syncEventHares("event_1");

    // Both calls should upsert the same record
    expect(mockUpsertHare).toHaveBeenCalledTimes(2);
    // Neither call should delete anything
    expect(mockDeleteManyHare).not.toHaveBeenCalled();
  });
});
