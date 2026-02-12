import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    source: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    sourceKennel: { create: vi.fn(), deleteMany: vi.fn() },
    rawEvent: { count: vi.fn() },
    $transaction: vi.fn((arr: unknown[]) => Promise.all(arr)),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createSource, updateSource, deleteSource } from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockSourceCreate = vi.mocked(prisma.source.create);
const mockSKCreate = vi.mocked(prisma.sourceKennel.create);
const mockRawEventCount = vi.mocked(prisma.rawEvent.count);

beforeEach(() => {
  vi.clearAllMocks();
  mockAdminAuth.mockResolvedValue(mockAdmin as never);
  mockSourceCreate.mockResolvedValue({ id: "src_1" } as never);
  mockSKCreate.mockResolvedValue({} as never);
});

describe("createSource", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await createSource(new FormData())).toEqual({ error: "Not authorized" });
  });

  it("returns error when missing required fields", async () => {
    const fd = new FormData();
    fd.set("name", ""); fd.set("url", ""); fd.set("type", "");
    expect(await createSource(fd)).toEqual({ error: "Name, URL, and type are required" });
  });

  it("creates source with SourceKennel links", async () => {
    const fd = new FormData();
    fd.set("name", "Test"); fd.set("url", "https://test.com"); fd.set("type", "HTML_SCRAPER");
    fd.set("kennelIds", "k1, k2");
    const result = await createSource(fd);
    expect(result).toEqual({ success: true });
    expect(mockSKCreate).toHaveBeenCalledTimes(2);
  });
});

describe("updateSource", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await updateSource("s1", new FormData())).toEqual({ error: "Not authorized" });
  });
});

describe("deleteSource", () => {
  it("returns error when not admin", async () => {
    mockAdminAuth.mockResolvedValueOnce(null);
    expect(await deleteSource("s1")).toEqual({ error: "Not authorized" });
  });

  it("returns error when source has raw events", async () => {
    mockRawEventCount.mockResolvedValueOnce(10 as never);
    const result = await deleteSource("s1");
    expect(result.error).toContain("10 raw event(s)");
  });

  it("deletes source when no raw events", async () => {
    mockRawEventCount.mockResolvedValueOnce(0 as never);
    const result = await deleteSource("s1");
    expect(result).toEqual({ success: true });
  });
});
