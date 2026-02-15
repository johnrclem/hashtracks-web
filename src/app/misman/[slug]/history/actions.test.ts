import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
  getRosterGroupId: vi.fn(),
  getRosterKennelIds: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    event: { findMany: vi.fn(), count: vi.fn() },
    kennelHasher: { findUnique: vi.fn(), findMany: vi.fn(), createMany: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getAttendanceHistory,
  getHasherDetail,
  seedRosterFromHares,
} from "./actions";

const mockMismanAuth = vi.mocked(getMismanUser);
const mockRosterGroupId = vi.mocked(getRosterGroupId);
const mockRosterKennelIds = vi.mocked(getRosterKennelIds);

beforeEach(() => {
  vi.clearAllMocks();
  mockMismanAuth.mockResolvedValue(mockMisman as never);
  mockRosterGroupId.mockResolvedValue("rg_1");
  mockRosterKennelIds.mockResolvedValue(["kennel_1"]);
});

// ── getAttendanceHistory ──

describe("getAttendanceHistory", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getAttendanceHistory("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns paginated event summaries", async () => {
    const mockEvent = {
      id: "e1",
      date: new Date("2026-02-01T12:00:00Z"),
      title: "Test Trail",
      runNumber: 100,
      kennel: { shortName: "NYCH3" },
      kennelAttendances: [
        {
          id: "ka1",
          paid: true,
          haredThisTrail: false,
          isVirgin: false,
          isVisitor: false,
          kennelHasher: { hashName: "Mudflap", nerdName: "John" },
        },
        {
          id: "ka2",
          paid: false,
          haredThisTrail: true,
          isVirgin: true,
          isVisitor: false,
          kennelHasher: { hashName: "Skippy", nerdName: null },
        },
      ],
    };

    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([mockEvent] as never);
    vi.mocked(prisma.event.count).mockResolvedValueOnce(1);

    const result = await getAttendanceHistory("kennel_1");

    expect(result.data).toHaveLength(1);
    expect(result.data![0].attendeeCount).toBe(2);
    expect(result.data![0].paidCount).toBe(1);
    expect(result.data![0].hareCount).toBe(1);
    expect(result.data![0].virginCount).toBe(1);
    expect(result.total).toBe(1);
    expect(result.page).toBe(1);
  });

  it("applies date filters when provided", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.event.count).mockResolvedValueOnce(0);

    await getAttendanceHistory("kennel_1", {
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });

    const findManyCall = vi.mocked(prisma.event.findMany).mock.calls[0][0];
    expect(findManyCall?.where).toHaveProperty("date");
  });

  it("filters by single kennelId, not roster group scope", async () => {
    mockRosterKennelIds.mockResolvedValueOnce(["kennel_1", "kennel_2"]);

    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.event.count).mockResolvedValueOnce(0);

    await getAttendanceHistory("kennel_1");

    const findManyCall = vi.mocked(prisma.event.findMany).mock.calls[0][0];
    expect(findManyCall?.where?.kennelId).toBe("kennel_1");
  });

  it("paginates correctly", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.event.count).mockResolvedValueOnce(50);

    const result = await getAttendanceHistory("kennel_1", {
      page: 2,
      pageSize: 25,
    });

    expect(result.page).toBe(2);
    expect(result.totalPages).toBe(2);
    const findManyCall = vi.mocked(prisma.event.findMany).mock.calls[0][0];
    expect(findManyCall?.skip).toBe(25);
    expect(findManyCall?.take).toBe(25);
  });
});

// ── getHasherDetail ──

describe("getHasherDetail", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await getHasherDetail("kennel_1", "kh_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);
    expect(await getHasherDetail("kennel_1", "kh_bad")).toEqual({
      error: "Hasher not found",
    });
  });

  it("returns error when hasher not in roster scope", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "other_rg",
      kennelId: "other_kennel",
      hashName: "Mudflap",
      nerdName: null,
      email: null,
      phone: null,
      notes: null,
      createdAt: new Date(),
      kennel: { shortName: "Other" },
      userLink: null,
      attendances: [],
    } as never);

    expect(await getHasherDetail("kennel_1", "kh_1")).toEqual({
      error: "Hasher is not in this kennel's roster scope",
    });
  });

  it("returns hasher with stats and attendance history", async () => {
    const eventDate = new Date("2026-01-15T12:00:00Z");
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "rg_1",
      kennelId: "kennel_1",
      hashName: "Mudflap",
      nerdName: "John Doe",
      email: "john@test.com",
      phone: null,
      notes: "Great hasher",
      createdAt: new Date("2026-01-01"),
      kennel: { shortName: "NYCH3" },
      userLink: null,
      attendances: [
        {
          id: "ka1",
          paid: true,
          haredThisTrail: true,
          isVirgin: false,
          isVisitor: false,
          createdAt: new Date(),
          event: {
            id: "e1",
            date: eventDate,
            title: "Test Trail",
            runNumber: 100,
            kennelId: "kennel_1",
            kennel: { shortName: "NYCH3" },
          },
        },
      ],
    } as never);

    const result = await getHasherDetail("kennel_1", "kh_1");

    expect(result.data).toBeDefined();
    expect(result.data!.hashName).toBe("Mudflap");
    expect(result.data!.stats.totalRuns).toBe(1);
    expect(result.data!.stats.hareCount).toBe(1);
    expect(result.data!.stats.paidCount).toBe(1);
    expect(result.data!.stats.firstRun).toBe(eventDate.toISOString());
    expect(result.data!.stats.lastRun).toBe(eventDate.toISOString());
    expect(result.data!.attendances).toHaveLength(1);
  });

  it("includes user link data when present", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "rg_1",
      kennelId: "kennel_1",
      hashName: "Mudflap",
      nerdName: null,
      email: null,
      phone: null,
      notes: null,
      createdAt: new Date(),
      kennel: { shortName: "NYCH3" },
      userLink: {
        status: "CONFIRMED",
        user: { hashName: "Mudflap", email: "mudflap@test.com" },
      },
      attendances: [],
    } as never);

    const result = await getHasherDetail("kennel_1", "kh_1");

    expect(result.data!.userLink).toEqual({
      status: "CONFIRMED",
      userHashName: "Mudflap",
      userEmail: "mudflap@test.com",
    });
  });
});

// ── seedRosterFromHares ──

describe("seedRosterFromHares", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await seedRosterFromHares("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns message when all names already exist", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "Mudflap, Skippy" },
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { hashName: "Mudflap", nerdName: null },
      { hashName: "Skippy", nerdName: null },
    ] as never);

    const result = await seedRosterFromHares("kennel_1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(0);
  });

  it("creates new hashers from unique hare names", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "Mudflap, Skippy" },
      { haresText: "New Hasher, mudflap" }, // mudflap is case-insensitive duplicate
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { hashName: "Mudflap", nerdName: null },
      { hashName: "Skippy", nerdName: null },
    ] as never);

    vi.mocked(prisma.kennelHasher.createMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    const result = await seedRosterFromHares("kennel_1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(vi.mocked(prisma.kennelHasher.createMany)).toHaveBeenCalledWith({
      data: [{ rosterGroupId: "rg_1", kennelId: "kennel_1", hashName: "New Hasher" }],
    });
  });

  it("parses ampersand and 'and' delimiters", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "Mudflap & Just Simon, Skippy and Trail Boss" },
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([] as never);

    vi.mocked(prisma.kennelHasher.createMany).mockResolvedValueOnce({
      count: 4,
    } as never);

    const result = await seedRosterFromHares("kennel_1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(4);
    const createCall = vi.mocked(prisma.kennelHasher.createMany).mock.calls[0][0];
    const names = (createCall as { data: { hashName: string }[] }).data.map(
      (d) => d.hashName,
    );
    expect(names).toEqual(["Mudflap", "Just Simon", "Skippy", "Trail Boss"]);
  });

  it("ignores placeholder values like N/A and TBD", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "Mudflap, N/A, TBD, ???, unknown" },
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([] as never);

    vi.mocked(prisma.kennelHasher.createMany).mockResolvedValueOnce({
      count: 1,
    } as never);

    const result = await seedRosterFromHares("kennel_1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(vi.mocked(prisma.kennelHasher.createMany)).toHaveBeenCalledWith({
      data: [{ rosterGroupId: "rg_1", kennelId: "kennel_1", hashName: "Mudflap" }],
    });
  });

  it("deduplicates against nerd names", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "John Doe" },
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { hashName: "Mudflap", nerdName: "John Doe" },
    ] as never);

    const result = await seedRosterFromHares("kennel_1");

    expect(result.success).toBe(true);
    expect(result.created).toBe(0);
  });

  it("uses roster group scope for queries", async () => {
    mockRosterKennelIds.mockResolvedValueOnce(["kennel_1", "kennel_2"]);

    vi.mocked(prisma.event.findMany).mockResolvedValueOnce([
      { haresText: "Mudflap" },
    ] as never);

    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { hashName: "Mudflap", nerdName: null },
    ] as never);

    await seedRosterFromHares("kennel_1");

    // Should query events from both kennels
    expect(vi.mocked(prisma.event.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          kennelId: { in: ["kennel_1", "kennel_2"] },
        }),
      }),
    );

    // Should query existing hashers by roster group
    expect(vi.mocked(prisma.kennelHasher.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rosterGroupId: "rg_1" },
      }),
    );
  });
});
