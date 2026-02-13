import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMisman = { id: "misman_1", email: "misman@test.com" };

vi.mock("@/lib/auth", () => ({
  getMismanUser: vi.fn(),
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
    },
    kennelHasherLink: { deleteMany: vi.fn() },
    kennel: { findUnique: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getMismanUser, getRosterKennelIds } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  createKennelHasher,
  updateKennelHasher,
  deleteKennelHasher,
  searchRoster,
} from "./actions";

const mockMismanAuth = vi.mocked(getMismanUser);
const mockRosterKennelIds = vi.mocked(getRosterKennelIds);

beforeEach(() => {
  vi.clearAllMocks();
  mockMismanAuth.mockResolvedValue(mockMisman as never);
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
    } as never);
    mockRosterKennelIds.mockResolvedValueOnce(["kennel_1"]);
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
    mockRosterKennelIds.mockResolvedValueOnce(["kennel_1", "kennel_2"]);
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
          kennelId: { in: ["kennel_1", "kennel_2"] },
        }),
      }),
    );
  });

  it("returns all hashers when query is empty", async () => {
    vi.mocked(prisma.kennelHasher.findMany).mockResolvedValueOnce([] as never);

    await searchRoster("kennel_1", "");
    expect(prisma.kennelHasher.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { kennelId: { in: ["kennel_1"] } },
      }),
    );
  });
});
