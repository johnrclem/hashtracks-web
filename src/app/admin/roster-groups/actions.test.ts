import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    rosterGroup: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    rosterGroupKennel: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
    kennelHasher: {
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    kennel: { findUnique: vi.fn() },
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  getRosterGroups,
  createRosterGroup,
  addKennelToGroup,
  removeKennelFromGroup,
  renameRosterGroup,
  deleteRosterGroup,
} from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
});

describe("getRosterGroups", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await getRosterGroups()).toEqual({ error: "Not authorized" });
  });

  it("returns groups with kennels and hasher counts", async () => {
    vi.mocked(prisma.rosterGroup.findMany).mockResolvedValueOnce([
      {
        id: "rg_1",
        name: "NYC Metro",
        kennels: [
          { kennel: { id: "k1", shortName: "NYCH3", slug: "nych3" } },
          { kennel: { id: "k2", shortName: "GGFM", slug: "ggfm" } },
        ],
        _count: { kennelHashers: 42 },
      },
    ] as never);

    const result = await getRosterGroups();
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toEqual({
      id: "rg_1",
      name: "NYC Metro",
      kennels: [
        { id: "k1", shortName: "NYCH3", slug: "nych3" },
        { id: "k2", shortName: "GGFM", slug: "ggfm" },
      ],
      hasherCount: 42,
    });
  });
});

describe("createRosterGroup", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await createRosterGroup("Test", ["k1", "k2"])).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when name is empty", async () => {
    expect(await createRosterGroup("", ["k1", "k2"])).toEqual({
      error: "Name is required",
    });
  });

  it("returns error when fewer than 2 kennels", async () => {
    expect(await createRosterGroup("Test", ["k1"])).toEqual({
      error: "At least 2 kennels are required",
    });
  });

  it("creates group and moves kennels", async () => {
    vi.mocked(prisma.rosterGroup.create).mockResolvedValueOnce({
      id: "rg_new",
    } as never);

    // Both kennels have existing standalone groups
    vi.mocked(prisma.rosterGroupKennel.findUnique)
      .mockResolvedValueOnce({ id: "rgk_1", groupId: "rg_old1" } as never)
      .mockResolvedValueOnce({ id: "rgk_2", groupId: "rg_old2" } as never);
    vi.mocked(prisma.rosterGroupKennel.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.kennelHasher.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.rosterGroupKennel.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.rosterGroup.delete).mockResolvedValue({} as never);
    vi.mocked(prisma.rosterGroupKennel.create).mockResolvedValue({} as never);

    const result = await createRosterGroup("NYC Metro", ["k1", "k2"]);
    expect(result).toEqual({ success: true, groupId: "rg_new" });
  });
});

describe("removeKennelFromGroup", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await removeKennelFromGroup("rg_1", "k1")).toEqual({
      error: "Not authorized",
    });
  });

  it("creates standalone group for removed kennel", async () => {
    vi.mocked(prisma.kennel.findUnique).mockResolvedValueOnce({
      shortName: "NYCH3",
    } as never);
    vi.mocked(prisma.rosterGroup.create).mockResolvedValueOnce({
      id: "rg_standalone",
    } as never);
    vi.mocked(prisma.rosterGroupKennel.update).mockResolvedValueOnce({} as never);
    vi.mocked(prisma.kennelHasher.updateMany).mockResolvedValueOnce({ count: 5 } as never);

    const result = await removeKennelFromGroup("rg_1", "k1");
    expect(result).toEqual({ success: true });
    expect(prisma.kennelHasher.updateMany).toHaveBeenCalledWith({
      where: { rosterGroupId: "rg_1", kennelId: "k1" },
      data: { rosterGroupId: "rg_standalone" },
    });
  });
});

describe("renameRosterGroup", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await renameRosterGroup("rg_1", "New Name")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when name is empty", async () => {
    expect(await renameRosterGroup("rg_1", "  ")).toEqual({
      error: "Name is required",
    });
  });

  it("renames successfully", async () => {
    vi.mocked(prisma.rosterGroup.update).mockResolvedValueOnce({} as never);

    const result = await renameRosterGroup("rg_1", "Philly Area");
    expect(result).toEqual({ success: true });
    expect(prisma.rosterGroup.update).toHaveBeenCalledWith({
      where: { id: "rg_1" },
      data: { name: "Philly Area" },
    });
  });
});

describe("deleteRosterGroup", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await deleteRosterGroup("rg_1")).toEqual({
      error: "Not authorized",
    });
  });

  it("returns error when group not found", async () => {
    vi.mocked(prisma.rosterGroup.findUnique).mockResolvedValueOnce(null);
    expect(await deleteRosterGroup("rg_bad")).toEqual({
      error: "Roster group not found",
    });
  });

  it("dissolves group into standalone groups", async () => {
    vi.mocked(prisma.rosterGroup.findUnique).mockResolvedValueOnce({
      id: "rg_1",
      kennels: [
        { id: "rgk_1", kennelId: "k1", kennel: { shortName: "NYCH3" } },
        { id: "rgk_2", kennelId: "k2", kennel: { shortName: "GGFM" } },
      ],
    } as never);

    vi.mocked(prisma.rosterGroup.create).mockResolvedValue({
      id: "rg_standalone",
    } as never);
    vi.mocked(prisma.rosterGroupKennel.update).mockResolvedValue({} as never);
    vi.mocked(prisma.kennelHasher.updateMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.kennelHasher.count).mockResolvedValueOnce(0);
    vi.mocked(prisma.rosterGroup.delete).mockResolvedValueOnce({} as never);

    const result = await deleteRosterGroup("rg_1");
    expect(result).toEqual({ success: true });
    // Should create standalone groups for each kennel
    expect(prisma.rosterGroup.create).toHaveBeenCalledTimes(2);
  });
});
