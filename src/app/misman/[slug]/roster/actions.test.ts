import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
  getRosterGroupId: vi.fn(),
  getRosterKennelIds: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennelHasher: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    kennelHasherLink: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    kennelAttendance: {
      findMany: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    userKennel: { findMany: vi.fn() },
    kennel: { findUnique: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getMismanUser, getRosterGroupId, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createKennelHasher,
  updateKennelHasher,
  deleteKennelHasher,
  searchRoster,
  suggestUserLinks,
  createUserLink,
  dismissUserLink,
  revokeUserLink,
  scanDuplicates,
  previewMerge,
  executeMerge,
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

describe("createKennelHasher", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await createKennelHasher("kennel_1", { hashName: "Mud" })).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when no name provided", async () => {
    expect(await createKennelHasher("kennel_1", {})).toEqual({
      error: "Either hash name or nerd name is required",
    });
  });

  it("returns error when names are empty strings", async () => {
    expect(
      await createKennelHasher("kennel_1", { hashName: "  ", nerdName: "" }),
    ).toEqual({
      error: "Either hash name or nerd name is required",
    });
  });

  it("creates hasher successfully with hash name", async () => {
    vi.mocked(prisma.kennelHasher.create).mockResolvedValueOnce({
      id: "kh_new",
    } as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      slug: "nych3",
    } as never);

    const result = await createKennelHasher("kennel_1", {
      hashName: "Mudflap",
      email: "mud@test.com",
    });
    expect(result).toEqual({ success: true, hasherId: "kh_new" });
    expect(prisma.kennelHasher.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        rosterGroupId: "rg_1",
        kennelId: "kennel_1",
        hashName: "Mudflap",
        email: "mud@test.com",
      }),
    });
  });

  it("creates hasher with only nerd name", async () => {
    vi.mocked(prisma.kennelHasher.create).mockResolvedValueOnce({
      id: "kh_new",
    } as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      slug: "nych3",
    } as never);

    const result = await createKennelHasher("kennel_1", {
      nerdName: "John Doe",
    });
    expect(result).toEqual({ success: true, hasherId: "kh_new" });
  });
});

describe("updateKennelHasher", () => {
  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);
    expect(
      await updateKennelHasher("kh_1", { hashName: "NewName" }),
    ).toEqual({ error: "Hasher not found" });
  });

  it("returns error when not authorized for any kennel in scope", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
      rosterGroup: { kennels: [{ kennelId: "kennel_1" }] },
    } as never);
    mockMismanAuth.mockReset();
    mockMismanAuth.mockResolvedValue(null);

    expect(
      await updateKennelHasher("kh_1", { hashName: "NewName" }),
    ).toEqual({ error: "Not authorized" });
  });

  it("updates hasher successfully", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
      rosterGroup: { kennels: [{ kennelId: "kennel_1" }] },
    } as never);
    mockMismanAuth.mockResolvedValue(mockMisman as never);

    const result = await updateKennelHasher("kh_1", {
      hashName: "NewName",
      nerdName: "Real Name",
    });
    expect(result).toEqual({ success: true });
    expect(prisma.kennelHasher.update).toHaveBeenCalledWith({
      where: { id: "kh_1" },
      data: expect.objectContaining({
        hashName: "NewName",
        nerdName: "Real Name",
      }),
    });
  });
});

describe("deleteKennelHasher", () => {
  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);
    expect(await deleteKennelHasher("kh_1")).toEqual({
      error: "Hasher not found",
    });
  });

  it("returns error when not authorized", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
      rosterGroup: { kennels: [{ kennelId: "kennel_1" }] },
      _count: { attendances: 0 },
    } as never);
    mockMismanAuth.mockResolvedValueOnce(null);

    expect(await deleteKennelHasher("kh_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("blocks deletion when hasher has attendance records", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
      rosterGroup: { kennels: [{ kennelId: "kennel_1" }] },
      _count: { attendances: 5 },
    } as never);

    const result = await deleteKennelHasher("kh_1");
    expect(result.error).toContain("5 attendance record(s)");
  });

  it("deletes hasher when no attendance records", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      kennelId: "kennel_1",
      kennel: { slug: "nych3" },
      rosterGroup: { kennels: [{ kennelId: "kennel_1" }] },
      _count: { attendances: 0 },
    } as never);

    const result = await deleteKennelHasher("kh_1");
    expect(result).toEqual({ success: true });
  });
});

describe("searchRoster", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await searchRoster("kennel_1", "mud")).toEqual({
      error: "Not authorized",
    });
  });

  it("searches across roster group scope", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1",
        kennelId: "kennel_1",
        hashName: "Mudflap",
        nerdName: "John",
        email: null,
        phone: null,
        notes: null,
        _count: { attendances: 10 },
      },
    ] as never);

    const result = await searchRoster("kennel_1", "mud");
    expect(result.data).toHaveLength(1);
    expect(result.data![0].hashName).toBe("Mudflap");

    expect(prisma.kennelHasher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          rosterGroupId: "rg_1",
        }),
      }),
    );
  });

  it("returns all hashers when query is empty", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([] as never);

    await searchRoster("kennel_1", "");
    expect(prisma.kennelHasher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { rosterGroupId: "rg_1" },
      }),
    );
  });
});

// ── USER LINKING TESTS ──

describe("suggestUserLinks", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await suggestUserLinks("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns matches above threshold", async () => {
    // Unlinked hasher with name "Mudflap"
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: "John Doe" },
    ] as never);

    // User with matching hash name
    vi.mocked(prisma.userKennel.findMany).mockResolvedValueOnce([
      {
        user: { id: "user_1", hashName: "Mudflap", nerdName: "John D.", email: "mud@test.com" },
      },
    ] as never);

    const result = await suggestUserLinks("kennel_1");
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        kennelHasherId: "kh_1",
        userId: "user_1",
        matchField: "hashName",
      }),
    );
    expect(result.data![0].matchScore).toBe(1);
  });

  it("returns empty when no hashers are unlinked", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([] as never);

    const result = await suggestUserLinks("kennel_1");
    expect(result.data).toEqual([]);
  });

  it("ignores matches below threshold", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: null },
    ] as never);

    vi.mocked(prisma.userKennel.findMany).mockResolvedValueOnce([
      {
        user: { id: "user_1", hashName: "Zephyr", nerdName: null, email: "z@test.com" },
      },
    ] as never);

    const result = await suggestUserLinks("kennel_1");
    expect(result.data).toEqual([]);
  });
});

describe("createUserLink", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await createUserLink("kennel_1", "kh_1", "user_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when hasher not found", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce(null);
    expect(await createUserLink("kennel_1", "kh_1", "user_1")).toEqual({
      error: "Hasher not found",
    });
  });

  it("returns error when hasher already has an active link", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "rg_1",
      kennelId: "kennel_1",
      userLink: { id: "link_1", status: "SUGGESTED" },
      kennel: { slug: "nych3" },
    } as never);

    expect(await createUserLink("kennel_1", "kh_1", "user_1")).toEqual({
      error: "This hasher already has an active link",
    });
  });

  it("creates a SUGGESTED link successfully", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "rg_1",
      kennelId: "kennel_1",
      userLink: null,
      kennel: { slug: "nych3" },
    } as never);
    vi.mocked(prisma.kennelHasherLink.findFirst).mockResolvedValueOnce(null);
    vi.mocked(prisma.kennelHasherLink.create).mockResolvedValueOnce({} as never);

    const result = await createUserLink("kennel_1", "kh_1", "user_1");
    expect(result).toEqual({ success: true });
    expect(prisma.kennelHasherLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kennelHasherId: "kh_1",
        userId: "user_1",
        status: "SUGGESTED",
        suggestedBy: "misman_1",
      }),
    });
  });

  it("blocks when user is already linked in roster scope", async () => {
    vi.mocked(prisma.kennelHasher.findUnique).mockResolvedValueOnce({
      id: "kh_1",
      rosterGroupId: "rg_1",
      kennelId: "kennel_1",
      userLink: null,
      kennel: { slug: "nych3" },
    } as never);
    vi.mocked(prisma.kennelHasherLink.findFirst).mockResolvedValueOnce({
      id: "existing_link",
    } as never);

    const result = await createUserLink("kennel_1", "kh_1", "user_1");
    expect(result.error).toContain("already linked to another hasher");
  });
});

describe("dismissUserLink", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await dismissUserLink("kennel_1", "link_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when link not found", async () => {
    vi.mocked(prisma.kennelHasherLink.findUnique).mockResolvedValueOnce(null);
    expect(await dismissUserLink("kennel_1", "link_1")).toEqual({
      error: "Link not found",
    });
  });

  it("updates link status to DISMISSED", async () => {
    vi.mocked(prisma.kennelHasherLink.findUnique).mockResolvedValueOnce({
      id: "link_1",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);
    vi.mocked(prisma.kennelHasherLink.update).mockResolvedValueOnce({} as never);

    const result = await dismissUserLink("kennel_1", "link_1");
    expect(result).toEqual({ success: true });
    expect(prisma.kennelHasherLink.update).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { status: "DISMISSED", dismissedBy: "misman_1" },
    });
  });
});

describe("revokeUserLink", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await revokeUserLink("kennel_1", "link_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when link not found", async () => {
    vi.mocked(prisma.kennelHasherLink.findUnique).mockResolvedValueOnce(null);
    expect(await revokeUserLink("kennel_1", "link_1")).toEqual({
      error: "Link not found",
    });
  });

  it("returns error when link is not CONFIRMED", async () => {
    vi.mocked(prisma.kennelHasherLink.findUnique).mockResolvedValueOnce({
      id: "link_1",
      status: "SUGGESTED",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);

    expect(await revokeUserLink("kennel_1", "link_1")).toEqual({
      error: "Can only revoke confirmed links",
    });
  });

  it("revokes a confirmed link by setting to DISMISSED", async () => {
    vi.mocked(prisma.kennelHasherLink.findUnique).mockResolvedValueOnce({
      id: "link_1",
      status: "CONFIRMED",
      kennelHasher: { kennel: { slug: "nych3" } },
    } as never);
    vi.mocked(prisma.kennelHasherLink.update).mockResolvedValueOnce({} as never);

    const result = await revokeUserLink("kennel_1", "link_1");
    expect(result).toEqual({ success: true });
    expect(prisma.kennelHasherLink.update).toHaveBeenCalledWith({
      where: { id: "link_1" },
      data: { status: "DISMISSED", dismissedBy: "misman_1" },
    });
  });
});

// ── MERGE DUPLICATES TESTS ──

describe("scanDuplicates", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await scanDuplicates("kennel_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("finds duplicate pairs above threshold", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: null },
      { id: "kh_2", hashName: "Mudfllap", nerdName: null }, // Typo variant
      { id: "kh_3", hashName: "Zephyr", nerdName: null },
    ] as never);

    const result = await scanDuplicates("kennel_1");
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual(
      expect.objectContaining({
        hasherId1: "kh_1",
        hasherId2: "kh_2",
        matchField: "hashName",
      }),
    );
    expect(result.data![0].score).toBeGreaterThanOrEqual(0.7);
  });

  it("returns empty when no duplicates", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "Mudflap", nerdName: null },
      { id: "kh_2", hashName: "Zephyr", nerdName: null },
    ] as never);

    const result = await scanDuplicates("kennel_1");
    expect(result.data).toEqual([]);
  });

  it("detects cross-field matches (hashName vs nerdName)", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      { id: "kh_1", hashName: "John Doe", nerdName: null },
      { id: "kh_2", hashName: null, nerdName: "John Doe" },
    ] as never);

    const result = await scanDuplicates("kennel_1");
    expect(result.data).toHaveLength(1);
    expect(result.data![0].matchField).toBe("hashName↔nerdName");
  });
});

describe("previewMerge", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(await previewMerge("kennel_1", "kh_1", ["kh_2"])).toEqual({
      error: "Not authorized",
    });
  });

  it("returns combined stats and no conflict", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "Mudflap",
        nerdName: null, email: "a@t.com", phone: null, notes: null,
        userLink: null, _count: { attendances: 5 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "Mudfllap",
        nerdName: null, email: null, phone: null, notes: null,
        userLink: null, _count: { attendances: 3 },
      },
    ] as never);

    // 1 overlapping event, 5 unique total
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      { kennelHasherId: "kh_1", eventId: "e1" },
      { kennelHasherId: "kh_1", eventId: "e2" },
      { kennelHasherId: "kh_1", eventId: "e3" },
      { kennelHasherId: "kh_2", eventId: "e3" }, // overlap
      { kennelHasherId: "kh_2", eventId: "e4" },
      { kennelHasherId: "kh_2", eventId: "e5" },
    ] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data).toBeDefined();
    expect(result.data!.totalAttendance).toBe(5);
    expect(result.data!.overlapCount).toBe(1);
    expect(result.data!.hasConflictingLinks).toBe(false);
    expect(result.data!.primary.id).toBe("kh_1");
  });

  it("detects conflicting user links", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        _count: { attendances: 0 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l2", userId: "user_2", status: "CONFIRMED" },
        _count: { attendances: 0 },
      },
    ] as never);
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data!.hasConflictingLinks).toBe(true);
  });

  it("allows merge when linked to same user", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        _count: { attendances: 0 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l2", userId: "user_1", status: "SUGGESTED" },
        _count: { attendances: 0 },
      },
    ] as never);
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data!.hasConflictingLinks).toBe(false);
  });

  it("recommends linked hasher as primary when only secondary is linked", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: null, _count: { attendances: 5 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        _count: { attendances: 2 },
      },
    ] as never);
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data!.recommendedPrimaryId).toBe("kh_2");
  });

  it("recommends linked hasher as primary when only primary is linked", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        _count: { attendances: 2 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: null, _count: { attendances: 5 },
      },
    ] as never);
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data!.recommendedPrimaryId).toBe("kh_1");
  });

  it("recommends hasher with more attendance when neither is linked", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: null, _count: { attendances: 2 },
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B", nerdName: null,
        email: null, phone: null, notes: null,
        userLink: null, _count: { attendances: 7 },
      },
    ] as never);
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);

    const result = await previewMerge("kennel_1", "kh_1", ["kh_2"]);
    expect(result.data!.recommendedPrimaryId).toBe("kh_2");
  });
});

describe("executeMerge", () => {
  it("returns error when not authorized", async () => {
    mockMismanAuth.mockResolvedValueOnce(null);
    expect(
      await executeMerge("kennel_1", "kh_1", ["kh_2"], {}),
    ).toEqual({ error: "Not authorized" });
  });

  it("blocks merge when linked to different users", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A",
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        kennel: { slug: "nych3" }, mergeLog: null,
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B",
        userLink: { id: "l2", userId: "user_2", status: "CONFIRMED" },
        kennel: { slug: "nych3" }, mergeLog: null,
      },
    ] as never);

    const result = await executeMerge("kennel_1", "kh_1", ["kh_2"], {});
    expect(result.error).toContain("linked to different users");
  });

  it("merges successfully with OR-merged attendance and reassignment", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "Mudflap",
        nerdName: null, email: "a@t.com", phone: null, notes: null,
        userLink: null, kennel: { slug: "nych3" }, mergeLog: null,
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "Mudfllap",
        nerdName: "John", email: null, phone: null, notes: null,
        userLink: null, kennel: { slug: "nych3" }, mergeLog: null,
      },
    ] as never);

    // Primary has e1 (paid=false), secondary has e1 (paid=true) + e2
    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([
      {
        id: "ka_1", kennelHasherId: "kh_1", eventId: "e1",
        paid: false, haredThisTrail: false, isVirgin: false,
        isVisitor: false, visitorLocation: null,
      },
      {
        id: "ka_2", kennelHasherId: "kh_2", eventId: "e1",
        paid: true, haredThisTrail: true, isVirgin: false,
        isVisitor: false, visitorLocation: null,
      },
      {
        id: "ka_3", kennelHasherId: "kh_2", eventId: "e2",
        paid: true, haredThisTrail: false, isVirgin: false,
        isVisitor: false, visitorLocation: null,
      },
    ] as never);

    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      slug: "nych3",
    } as never);

    const result = await executeMerge("kennel_1", "kh_1", ["kh_2"], {
      hashName: "Mudflap",
    });
    expect(result).toEqual({ success: true, mergedCount: 1 });

    // Verify $transaction was called
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("transfers user link from secondary to primary", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A",
        nerdName: null, email: null, phone: null, notes: null,
        userLink: null, kennel: { slug: "nych3" }, mergeLog: null,
      },
      {
        id: "kh_2", rosterGroupId: "rg_1", hashName: "B",
        nerdName: null, email: null, phone: null, notes: null,
        userLink: { id: "l1", userId: "user_1", status: "CONFIRMED" },
        kennel: { slug: "nych3" }, mergeLog: null,
      },
    ] as never);

    vi.mocked(prisma.kennelAttendance.findMany).mockResolvedValueOnce([] as never);
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      slug: "nych3",
    } as never);

    const result = await executeMerge("kennel_1", "kh_1", ["kh_2"], {});
    expect(result).toEqual({ success: true, mergedCount: 1 });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("returns error when hasher not in roster group", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([
      {
        id: "kh_1", rosterGroupId: "rg_1", hashName: "A",
        userLink: null, kennel: null, mergeLog: null,
      },
      {
        id: "kh_2", rosterGroupId: "other_rg", hashName: "B",
        userLink: null, kennel: null, mergeLog: null,
      },
    ] as never);

    const result = await executeMerge("kennel_1", "kh_1", ["kh_2"], {});
    expect(result.error).toContain("same roster group");
  });
});
