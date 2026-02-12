import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1", clerkId: "clerk_admin", email: "admin@test.com" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    kennel: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    kennelAlias: { deleteMany: vi.fn() },
    sourceKennel: { deleteMany: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createKennel, updateKennel, deleteKennel } from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockKennelFindFirst = vi.mocked(prisma.kennel.findFirst);
const mockKennelFindUnique = vi.mocked(prisma.kennel.findUnique);
const mockKennelCreate = vi.mocked(prisma.kennel.create);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
});

describe("createKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    expect(await createKennel(fd)).toEqual({ error: "Not authorized" });
  });

  it("returns error when missing required fields", async () => {
    const fd = new FormData();
    fd.set("shortName", "");
    fd.set("fullName", "");
    fd.set("region", "");
    expect(await createKennel(fd)).toEqual({
      error: "Short name, full name, and region are required",
    });
  });

  it("returns error when shortName already exists", async () => {
    mockKennelFindFirst.mockResolvedValueOnce({ id: "existing" } as never);
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "NYC");
    expect(await createKennel(fd)).toEqual({
      error: "A kennel with that short name already exists",
    });
  });

  it("creates kennel with aliases", async () => {
    mockKennelFindFirst.mockResolvedValueOnce(null);
    mockKennelCreate.mockResolvedValueOnce({} as never);
    const fd = new FormData();
    fd.set("shortName", "TestH3");
    fd.set("fullName", "Test Hash");
    fd.set("region", "NYC");
    fd.set("aliases", "Test, TH3");
    const result = await createKennel(fd);
    expect(result).toEqual({ success: true });
    expect(mockKennelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          shortName: "TestH3",
          slug: "testh3",
          aliases: { create: [{ alias: "Test" }, { alias: "TH3" }] },
        }),
      }),
    );
  });

  it("generates correct slug from shortName with parens", async () => {
    mockKennelFindFirst.mockResolvedValueOnce(null);
    mockKennelCreate.mockResolvedValueOnce({} as never);
    const fd = new FormData();
    fd.set("shortName", "Drinking Practice (NYC)");
    fd.set("fullName", "Drinking Practice NYC");
    fd.set("region", "NYC");
    await createKennel(fd);
    expect(mockKennelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slug: "drinking-practice-nyc" }),
      }),
    );
  });
});

describe("updateKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    const fd = new FormData();
    expect(await updateKennel("k1", fd)).toEqual({ error: "Not authorized" });
  });

  it("returns error on uniqueness conflict", async () => {
    mockKennelFindFirst.mockResolvedValueOnce({ id: "other" } as never);
    const fd = new FormData();
    fd.set("shortName", "NYCH3");
    fd.set("fullName", "NYC Hash");
    fd.set("region", "NYC");
    expect(await updateKennel("k1", fd)).toEqual({
      error: "A kennel with that short name already exists",
    });
  });
});

describe("deleteKennel", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await deleteKennel("k1")).toEqual({ error: "Not authorized" });
  });

  it("returns error when kennel not found", async () => {
    mockKennelFindUnique.mockResolvedValueOnce(null);
    expect(await deleteKennel("k1")).toEqual({ error: "Kennel not found" });
  });

  it("returns error when kennel has events", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 5, members: 0 },
    } as never);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("5 event(s)");
  });

  it("returns error when kennel has members", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 3 },
    } as never);
    const result = await deleteKennel("k1");
    expect(result.error).toContain("3 subscriber(s)");
  });

  it("deletes kennel when no events or members", async () => {
    mockKennelFindUnique.mockResolvedValueOnce({
      id: "k1", _count: { events: 0, members: 0 },
    } as never);
    const result = await deleteKennel("k1");
    expect(result).toEqual({ success: true });
  });
});
