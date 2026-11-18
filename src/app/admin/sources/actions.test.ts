import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    source: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    sourceKennel: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    rawEvent: { count: vi.fn(), deleteMany: vi.fn() },
    alert: { findMany: vi.fn(), update: vi.fn() },
    kennel: { findFirst: vi.fn() },
    kennelAlias: { findFirst: vi.fn() },
    $transaction: vi.fn((arg: unknown) =>
      typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(prisma) : Promise.all(arg as unknown[]),
    ),
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/pipeline/kennel-resolver", () => ({
  resolveKennelTag: vi.fn(),
  clearResolverCache: vi.fn(),
}));
vi.mock("@/pipeline/scrape", () => ({
  scrapeSource: vi.fn(),
}));
vi.mock("@/lib/kennel-utils", () => ({
  buildKennelIdentifiers: vi.fn(),
  createKennelRecord: vi.fn(),
}));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveKennelTag } from "@/pipeline/kennel-resolver";
import { createSource, updateSource, deleteSource, linkKennelToSourceDirect, createKennelForSource, updateSourceKennelSlug } from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockSourceCreate = vi.mocked(prisma.source.create);
const mockSKCreate = vi.mocked(prisma.sourceKennel.create);

const mockResolveKennelTag = vi.mocked(resolveKennelTag);
const mockSourceFindUnique = vi.mocked(prisma.source.findUnique);
const mockSKUpdate = vi.mocked(prisma.sourceKennel.update);
const _mockSKDelete = vi.mocked(prisma.sourceKennel.delete);
const mockAlertFindMany = vi.mocked(prisma.alert.findMany);

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

  it("deletes source and cascades raw events", async () => {
    const result = await deleteSource("s1");
    expect(result).toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const txArg = vi.mocked(prisma.$transaction).mock.calls[0][0];
    expect(Array.isArray(txArg)).toBe(true);
    expect(txArg).toHaveLength(3); // rawEvent.deleteMany, sourceKennel.deleteMany, source.delete
    expect(prisma.rawEvent.deleteMany).toHaveBeenCalledWith({ where: { sourceId: "s1" } });
  });
});

describe("createSource kennel linking", () => {
  it("creates SourceKennel links from form kennelIds", async () => {
    const fd = new FormData();
    fd.set("name", "Test");
    fd.set("url", "https://test.com");
    fd.set("type", "HTML_SCRAPER");
    fd.set("kennelIds", "k1, k2");

    const result = await createSource(fd);
    expect(result).toEqual({ success: true });
    expect(mockSKCreate).toHaveBeenCalledTimes(2);
    const createdIds = mockSKCreate.mock.calls.map((c) => (c[0] as { data: { kennelId: string } }).data.kennelId);
    expect(createdIds).toContain("k1");
    expect(createdIds).toContain("k2");
  });

  it("does not resolve slugs from config (legacy behavior removed)", async () => {
    const fd = new FormData();
    fd.set("name", "Hash Rego");
    fd.set("url", "https://hashrego.com/events");
    fd.set("type", "HASHREGO");
    fd.set("kennelIds", "k1");

    await createSource(fd);
    // Slug resolution no longer happens — only form kennelIds are used
    expect(mockResolveKennelTag).not.toHaveBeenCalled();
    expect(mockSKCreate).toHaveBeenCalledTimes(1);
  });
});

describe("linkKennelToSourceDirect externalSlug", () => {
  const mockSKUpsert = vi.mocked(prisma.sourceKennel.upsert);

  it("sets externalSlug on SourceKennel for HASHREGO sources", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k_uh3", matched: true });
    mockSKUpsert.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({
      id: "s1",
      type: "HASHREGO",
    } as never);
    mockAlertFindMany.mockResolvedValue([] as never);

    const result = await linkKennelToSourceDirect("s1", "UH3");
    expect(result).toEqual({ success: true });

    // Should upsert SourceKennel with externalSlug
    expect(mockSKUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "s1", kennelId: "k_uh3" } },
      update: { externalSlug: "UH3" },
      create: { sourceId: "s1", kennelId: "k_uh3", externalSlug: "UH3" },
    });
  });

  it("does not set externalSlug for non-HASHREGO sources", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k1", matched: true });
    mockSKUpsert.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({
      id: "s1",
      type: "HTML_SCRAPER",
    } as never);
    mockAlertFindMany.mockResolvedValue([] as never);

    await linkKennelToSourceDirect("s1", "UH3");

    // Should upsert without externalSlug
    expect(mockSKUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "s1", kennelId: "k1" } },
      update: {},
      create: { sourceId: "s1", kennelId: "k1" },
    });
  });
});

describe("createKennelForSource externalSlug", () => {
  const mockSKUpsert = vi.mocked(prisma.sourceKennel.upsert);

  it("sets externalSlug to tag (not shortName) for HASHREGO sources", async () => {
    const { createKennelRecord } = await import("@/lib/kennel-utils");
    vi.mocked(createKennelRecord).mockResolvedValue({ kennelId: "k_new" });
    mockSKUpsert.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({ id: "s1", type: "HASHREGO" } as never);

    await createKennelForSource("s1", "UPSTATE-H3", { shortName: "UH3", fullName: "Upstate H3", region: "NY" });

    expect(mockSKUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "s1", kennelId: "k_new" } },
      update: { externalSlug: "UPSTATE-H3" },
      create: { sourceId: "s1", kennelId: "k_new", externalSlug: "UPSTATE-H3" },
    });
  });

  it("returns error when source not found", async () => {
    const { createKennelRecord } = await import("@/lib/kennel-utils");
    vi.mocked(createKennelRecord).mockResolvedValue({ kennelId: "k_new" });
    mockSourceFindUnique.mockResolvedValue(null as never);

    const result = await createKennelForSource("s1", "UPSTATE-H3", { shortName: "UH3", fullName: "Upstate H3", region: "NY" });
    expect(result).toMatchObject({ error: "Source not found" });
  });
});

describe("updateSourceKennelSlug", () => {
  it("rejects unauthenticated requests", async () => {
    mockAdminAuth.mockResolvedValue(null as never);
    const result = await updateSourceKennelSlug("sk1", "BFMH3");
    expect(result).toMatchObject({ success: false, error: "Unauthorized" });
  });

  it("uppercases and trims the slug", async () => {
    mockAdminAuth.mockResolvedValue({ id: "admin" } as never);
    mockSKUpdate.mockResolvedValue({ sourceId: "src1" } as never);

    await updateSourceKennelSlug("sk1", "  bfmh3  ");
    expect(mockSKUpdate).toHaveBeenCalledWith({
      where: { id: "sk1" },
      data: { externalSlug: "BFMH3" },
      select: { sourceId: true },
    });
  });

  it("sets null for empty string", async () => {
    mockAdminAuth.mockResolvedValue({ id: "admin" } as never);
    mockSKUpdate.mockResolvedValue({ sourceId: "src1" } as never);

    await updateSourceKennelSlug("sk1", "");
    expect(mockSKUpdate).toHaveBeenCalledWith({
      where: { id: "sk1" },
      data: { externalSlug: null },
      select: { sourceId: true },
    });
  });
});

describe("archive sources (onboarding backfill design 6.5)", () => {
  const archive = { archiveOnly: true, name: "Zagreb H4 run history", type: "ICAL_FEED", trustLevel: 5, kennels: [{ kennelId: "k1" }] };
  function form(overrides: Record<string, string> = {}): FormData {
    const fd = new FormData();
    const values = { name: archive.name, url: "https://x", type: archive.type, kennelIds: "k1", ...overrides };
    for (const [k, v] of Object.entries(values)) fd.set(k, v);
    return fd;
  }

  beforeEach(() => mockSourceFindUnique.mockResolvedValue(archive as never));

  it("refuses delete, enable, relink, a new kennel and a new alias", async () => {
    const { toggleSourceEnabled, createAliasForSource } = await import("./actions");
    expect(await createKennelForSource("s1", "x", { shortName: "X", fullName: "X", region: "R" })).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(await deleteSource("s1")).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(await toggleSourceEnabled("s1", true)).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(await linkKennelToSourceDirect("s1", "x")).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(await createAliasForSource("s1", "x", "k2")).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(prisma.source.delete).not.toHaveBeenCalled();
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it.each([
    ["a rename", { name: "Renamed" }],
    ["a retype", { type: "HTML_SCRAPER" }],
    ["a relink", { kennelIds: "k1, k2" }],
    ["a trust change", { trustLevel: "9" }],
  ])("updateSource refuses %s", async (_label, overrides) => {
    expect(await updateSource("s1", form(overrides))).toMatchObject({ error: expect.stringContaining("archive source") });
    expect(prisma.source.update).not.toHaveBeenCalled();
  });

  it("updateSource accepts a save that resubmits the same name, type and links", async () => {
    vi.mocked(prisma.sourceKennel.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.source.update).mockResolvedValue({} as never);
    expect(await updateSource("s1", form({ scrapeDays: "30" }))).toEqual({ success: true });
  });

  it("unlinkKennelFromSource refuses an archive source's link", async () => {
    const { unlinkKennelFromSource } = await import("./actions");
    vi.mocked(prisma.sourceKennel.findUnique).mockResolvedValue({ sourceId: "s1" } as never);
    expect(await unlinkKennelFromSource("sk1")).toMatchObject({ success: false });
    expect(prisma.sourceKennel.delete).not.toHaveBeenCalled();
  });
});
