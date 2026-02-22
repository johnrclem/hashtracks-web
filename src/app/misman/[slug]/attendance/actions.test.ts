import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
  getRosterGroupId: vi.fn(),
  getRosterKennelIds: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findUnique: vi.fn(), findMany: vi.fn() },
    kennelHasher: { findUnique: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    kennelAttendance: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    attendance: { findMany: vi.fn() },
    kennelHasherLink: { findFirst: vi.fn() },
    eventHare: { deleteMany: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/misman/hare-sync", () => ({
  syncEventHares: vi.fn().mockResolvedValue(undefined),
}));

import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  recordAttendance,
  removeAttendance,
  updateAttendance,
  clearEventAttendance,
  getEventAttendance,
  quickAddHasher,
  getSuggestions,
  getHasherForEdit,
} from "./actions";

const mockMismanAuth = vi.mocked(getMismanUser);
const mockRosterGroupId = vi.mocked(getRosterGroupId);
const mockRosterKennelIds = vi.mocked(getRosterKennelIds);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-06-15T15:00:00Z"));
  vi.clearAllMocks();
  mockMismanAuth.mockResolvedValue(mockMisman as never);
  mockRosterGroupId.mockResolvedValue("rg_1");
  mockRosterKennelIds.mockResolvedValue(["kennel_1"]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("recordAttendance", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Not authorized" });
  });

  it("returns error when event not found", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce(null);
    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Event not found" });
  });

  it("returns error when event not in roster scope", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "other_kennel",
      date: new Date(),
    } as never);

    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Event does not belong to this kennel or roster group" });
  });

  it("returns error when event is older than 1 year", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "kennel_1",
      date: new Date("2024-01-15T12:00:00Z"),
    } as never);

    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Cannot record attendance for events older than 1 year" });
  });

  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "kennel_1",
      date: new Date(),
    } as never);
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);

    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Hasher not found" });
  });

  it("returns error when hasher not in roster scope", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "kennel_1",
      date: new Date(),
    } as never);
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      rosterGroupId: "other_rg",
    } as never);

    expect(
      await recordAttendance("kennel_1", "event_1", "kh_1"),
    ).toEqual({ error: "Hasher is not in this kennel's roster scope" });
  });

  it("records attendance successfully via upsert", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "kennel_1",
      date: new Date(),
    } as never);
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      rosterGroupId: "rg_1",
    } as never);
    vi.mocked(prisma.kennelAttendance.upsert).mockResolvedValueOnce({} as never);

    const result = await recordAttendance("kennel_1", "event_1", "kh_1", {
      paid: true,
      haredThisTrail: true,
    });
    expect(result).toEqual({ success: true });

    expect(prisma.kennelAttendance.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kennelHasherId_eventId: { kennelHasherId: "kh_1", eventId: "event_1" },
        },
        create: expect.objectContaining({
          kennelHasherId: "kh_1",
          eventId: "event_1",
          paid: true,
          haredThisTrail: true,
          recordedBy: "misman_1",
        }),
      }),
    );
  });
});

describe("removeAttendance", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await removeAttendance("kennel_1", "ka_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when record not found", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce(null);
    expect(await removeAttendance("kennel_1", "ka_1")).toEqual({
      error: "Attendance record not found",
    });
  });

  it("removes attendance successfully", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
    } as never);
    vi.mocked(prisma.kennelAttendance.delete).mockResolvedValueOnce({} as never);

    expect(await removeAttendance("kennel_1", "ka_1")).toEqual({
      success: true,
    });
  });
});

describe("updateAttendance", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await updateAttendance("kennel_1", "ka_1", { paid: true })).toEqual(
      { error: "Not authorized" },
    );
  });

  it("returns error when record not found", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce(null);
    expect(await updateAttendance("kennel_1", "ka_1", { paid: true })).toEqual(
      { error: "Attendance record not found" },
    );
  });

  it("updates specific fields", async () => {
    vi.mocked(prisma.kennelAttendance.findUnique).mockResolvedValueOnce({
      id: "ka_1",
    } as never);

    // Need to mock the update - import the actual function
    vi.mocked(prisma.kennelAttendance as unknown as { update: ReturnType<typeof vi.fn> }).update =
      vi.fn().mockResolvedValueOnce({});

    const result = await updateAttendance("kennel_1", "ka_1", {
      paid: true,
      haredThisTrail: false,
    });
    expect(result).toEqual({ success: true });
  });
});

describe("clearEventAttendance", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await clearEventAttendance("kennel_1", "event_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("deletes all attendance for event", async () => {
    vi.mocked(prisma.kennelAttendance.deleteMany).mockResolvedValueOnce({
      count: 15,
    } as never);

    const result = await clearEventAttendance("kennel_1", "event_1");
    expect(result).toEqual({ success: true, deleted: 15 });
    expect(prisma.kennelAttendance.deleteMany).toHaveBeenCalledWith({
      where: { eventId: "event_1" },
    });
  });
});

describe("getEventAttendance", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getEventAttendance("kennel_1", "event_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns serialized attendance records and user activity", async () => {
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      {
        id: "ka_1",
        kennelHasherId: "kh_1",
        paid: true,
        haredThisTrail: false,
        isVirgin: false,
        isVisitor: false,
        visitorLocation: null,
        referralSource: null,
        referralOther: null,
        createdAt: new Date("2026-02-13"),
        kennelHasher: {
          id: "kh_1",
          hashName: "Mudflap",
          nerdName: "John",
          kennelId: "kennel_1",
        },
        recordedByUser: { hashName: "Trail Boss", email: "boss@test.com" },
      },
    ] as never);
    vi.mocked(prisma.attendance.findMany).mockResolvedValueOnce([] as never);

    const result = await getEventAttendance("kennel_1", "event_1");
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        id: "ka_1",
        hashName: "Mudflap",
        nerdName: "John",
        paid: true,
        recordedBy: "Trail Boss",
      }),
    );
    expect(result.userActivity).toEqual([]);
  });

  it("returns user activity with linked status", async () => {
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.attendance.findMany).mockResolvedValueOnce([
      {
        userId: "user_1",
        eventId: "event_1",
        status: "INTENDING",
        user: { id: "user_1", hashName: "Trail Runner", email: "runner@test.com" },
      },
    ] as never);
    vi.mocked(prisma.kennelHasherLink.findFirst).mockResolvedValueOnce(null);

    const result = await getEventAttendance("kennel_1", "event_1");
    expect(result.userActivity).toHaveLength(1);
    expect(result.userActivity![0]).toEqual(
      expect.objectContaining({
        userId: "user_1",
        hashName: "Trail Runner",
        status: "INTENDING",
        isLinked: false,
        linkedHasherId: null,
      }),
    );
  });

  it("shows user as linked when KennelHasherLink exists", async () => {
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.attendance.findMany).mockResolvedValueOnce([
      {
        userId: "user_1",
        eventId: "event_1",
        status: "CONFIRMED",
        user: { id: "user_1", hashName: "Linked User", email: "linked@test.com" },
      },
    ] as never);
    vi.mocked(prisma.kennelHasherLink.findFirst).mockResolvedValueOnce({
      kennelHasherId: "kh_1",
    } as never);

    const result = await getEventAttendance("kennel_1", "event_1");
    expect(result.userActivity![0]).toEqual(
      expect.objectContaining({
        isLinked: true,
        linkedHasherId: "kh_1",
      }),
    );
  });
});

describe("quickAddHasher", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(
      await quickAddHasher("kennel_1", "event_1", { hashName: "New" }),
    ).toEqual({ error: "Not authorized" });
  });

  it("returns error when no name provided", async () => {
    expect(
      await quickAddHasher("kennel_1", "event_1", {}),
    ).toEqual({ error: "Either hash name or nerd name is required" });
  });

  it("creates hasher and records attendance in one step", async () => {
    vi.mocked(prisma.event.findUnique).mockResolvedValueOnce({
      id: "event_1",
      kennelId: "kennel_1",
      date: new Date(),
    } as never);
    vi.mocked(prisma.kennelHasher.create).mockResolvedValueOnce({
      id: "kh_new",
    } as never);
    vi.mocked(prisma.kennelAttendance.create).mockResolvedValueOnce({} as never);

    const result = await quickAddHasher("kennel_1", "event_1", {
      hashName: "Newbie",
      isVirgin: true,
    });
    expect(result).toEqual({ success: true, hasherId: "kh_new" });

    expect(prisma.kennelHasher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rosterGroupId: "rg_1",
        kennelId: "kennel_1",
        hashName: "Newbie",
      }),
    });
    expect(prisma.kennelAttendance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kennelHasherId: "kh_new",
        eventId: "event_1",
        isVirgin: true,
        recordedBy: "misman_1",
      }),
    });
  });
});

describe("getSuggestions", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getSuggestions("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns enriched suggestions with hasher names", async () => {
    const weekAgo = new Date("2026-06-08T12:00:00Z");
    const twoWeeksAgo = new Date("2026-06-01T12:00:00Z");
    const threeWeeksAgo = new Date("2026-05-25T12:00:00Z");

    // 3 events (minimum for suggestions)
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { id: "e1", date: weekAgo },
      { id: "e2", date: twoWeeksAgo },
      { id: "e3", date: threeWeeksAgo },
    ] as never);

    // Attendance: hasher attended all 3
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      { kennelHasherId: "kh_1", eventId: "e1", event: { date: weekAgo, kennelId: "kennel_1" } },
      { kennelHasherId: "kh_1", eventId: "e2", event: { date: twoWeeksAgo, kennelId: "kennel_1" } },
      { kennelHasherId: "kh_1", eventId: "e3", event: { date: threeWeeksAgo, kennelId: "kennel_1" } },
    ] as never);

    // Roster: 1 hasher
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John" },
    ] as never);

    const result = await getSuggestions("kennel_1");
    expect(result.data).toBeDefined();
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        kennelHasherId: "kh_1",
        hashName: "Mudflap",
        nerdName: "John",
      }),
    );
    expect(result.data![0].score).toBeGreaterThan(0.5);
  });

  it("returns empty when too few events", async () => {
    // Only 2 events (below minimum of 3)
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { id: "e1", date: new Date() },
      { id: "e2", date: new Date() },
    ] as never);

    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: null },
    ] as never);

    const result = await getSuggestions("kennel_1");
    expect(result.data).toEqual([]);
  });
});

describe("getHasherForEdit", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getHasherForEdit("kennel_1", "kh_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);
    expect(await getHasherForEdit("kennel_1", "kh_missing")).toEqual({
      error: "Hasher not found",
    });
  });

  it("returns full hasher data for editing", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      hashName: "Mudflap",
      nerdName: "John",
      email: "john@test.com",
      phone: "555-1234",
      notes: "Original runner",
    } as never);

    const result = await getHasherForEdit("kennel_1", "kh_1");
    expect(result.data).toEqual({
      id: "kh_1",
      hashName: "Mudflap",
      nerdName: "John",
      email: "john@test.com",
      phone: "555-1234",
      notes: "Original runner",
    });
  });
});
