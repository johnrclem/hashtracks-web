import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAdmin = { id: "admin_1" };

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    source: { create: vi.fn(), update: vi.fn(), delete: vi.fn(), findUnique: vi.fn() },
    sourceKennel: { create: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn() },
    rawEvent: { count: vi.fn() },
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

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveKennelTag } from "@/pipeline/kennel-resolver";
import { createSource, updateSource, deleteSource, linkKennelToSourceDirect, getHashRegoSlugDrift } from "./actions";

const mockAdminAuth = vi.mocked(getAdminUser);
const mockSourceCreate = vi.mocked(prisma.source.create);
const mockSKCreate = vi.mocked(prisma.sourceKennel.create);
const mockRawEventCount = vi.mocked(prisma.rawEvent.count);
const mockResolveKennelTag = vi.mocked(resolveKennelTag);
const mockSourceFindUnique = vi.mocked(prisma.source.findUnique);
const mockSourceUpdate = vi.mocked(prisma.source.update);
const mockSKFindUnique = vi.mocked(prisma.sourceKennel.findUnique);
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

describe("HASHREGO slug-to-link auto-sync", () => {
  it("createSource auto-links kennels resolved from slugs", async () => {
    mockResolveKennelTag.mockImplementation(async (tag: string) => {
      if (tag === "UH3") return { kennelId: "k_uh3", matched: true };
      return { kennelId: null, matched: false };
    });

    const fd = new FormData();
    fd.set("name", "Hash Rego");
    fd.set("url", "https://hashrego.com/events");
    fd.set("type", "HASHREGO");
    fd.set("config", JSON.stringify({ kennelSlugs: ["UH3"] }));
    fd.set("kennelIds", "k1");

    const result = await createSource(fd);
    expect(result).toEqual({ success: true });
    // Should create links for both k1 (form) and k_uh3 (slug-resolved)
    expect(mockSKCreate).toHaveBeenCalledTimes(2);
    const createdIds = mockSKCreate.mock.calls.map((c) => (c[0] as { data: { kennelId: string } }).data.kennelId);
    expect(createdIds).toContain("k1");
    expect(createdIds).toContain("k_uh3");
  });

  it("createSource does not duplicate if slug resolves to already-linked kennel", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k1", matched: true });

    const fd = new FormData();
    fd.set("name", "Hash Rego");
    fd.set("url", "https://hashrego.com/events");
    fd.set("type", "HASHREGO");
    fd.set("config", JSON.stringify({ kennelSlugs: ["BFM"] }));
    fd.set("kennelIds", "k1");

    await createSource(fd);
    // k1 is both form-selected and slug-resolved — should only create once
    expect(mockSKCreate).toHaveBeenCalledTimes(1);
  });

  it("updateSource auto-links slug-resolved kennels", async () => {
    mockResolveKennelTag.mockImplementation(async (tag: string) => {
      if (tag === "UH3") return { kennelId: "k_uh3", matched: true };
      if (tag === "BFM") return { kennelId: "k_bfm", matched: true };
      return { kennelId: null, matched: false };
    });

    const fd = new FormData();
    fd.set("name", "Hash Rego");
    fd.set("url", "https://hashrego.com/events");
    fd.set("type", "HASHREGO");
    fd.set("config", JSON.stringify({ kennelSlugs: ["UH3", "BFM"] }));
    fd.set("kennelIds", "k_bfm"); // only BFM was in the form

    const result = await updateSource("s1", fd);
    expect(result).toEqual({ success: true });
    // Transaction should create links for both k_bfm and k_uh3
    const txCalls = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
    expect(txCalls).toHaveLength(2); // deleteMany + update
  });

  it("does not resolve slugs for non-HASHREGO sources", async () => {
    const fd = new FormData();
    fd.set("name", "Cal");
    fd.set("url", "https://cal.google.com");
    fd.set("type", "GOOGLE_CALENDAR");
    fd.set("kennelIds", "k1");

    await createSource(fd);
    expect(mockResolveKennelTag).not.toHaveBeenCalled();
    expect(mockSKCreate).toHaveBeenCalledTimes(1);
  });
});

describe("HASHREGO link-to-slug auto-sync", () => {
  it("linkKennelToSourceDirect adds slug to HASHREGO config", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k_uh3", matched: true });
    mockSKFindUnique.mockResolvedValue(null as never);
    mockSKCreate.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({
      id: "s1",
      type: "HASHREGO",
      config: { kennelSlugs: ["BFM"] },
    } as never);
    mockAlertFindMany.mockResolvedValue([] as never);

    const result = await linkKennelToSourceDirect("s1", "UH3");
    expect(result).toEqual({ success: true });

    // Should update source config to include UH3
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1" },
        data: { config: { kennelSlugs: ["BFM", "UH3"] } },
      }),
    );
  });

  it("linkKennelToSourceDirect does not add duplicate slug", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k_bfm", matched: true });
    mockSKFindUnique.mockResolvedValue(null as never);
    mockSKCreate.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({
      id: "s1",
      type: "HASHREGO",
      config: { kennelSlugs: ["BFM"] },
    } as never);
    mockAlertFindMany.mockResolvedValue([] as never);

    await linkKennelToSourceDirect("s1", "BFM");
    // Config already has BFM — should NOT call update
    const configUpdateCalls = mockSourceUpdate.mock.calls.filter(
      (c) => (c[0] as { data: { config?: unknown } }).data.config !== undefined,
    );
    expect(configUpdateCalls).toHaveLength(0);
  });

  it("linkKennelToSourceDirect skips slug sync for non-HASHREGO sources", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: "k1", matched: true });
    mockSKFindUnique.mockResolvedValue(null as never);
    mockSKCreate.mockResolvedValue({} as never);
    mockSourceFindUnique.mockResolvedValue({
      id: "s1",
      type: "HTML_SCRAPER",
      config: null,
    } as never);
    mockAlertFindMany.mockResolvedValue([] as never);

    await linkKennelToSourceDirect("s1", "UH3");
    // Should not update config for non-HASHREGO
    const configUpdateCalls = mockSourceUpdate.mock.calls.filter(
      (c) => (c[0] as { data: { config?: unknown } }).data.config !== undefined,
    );
    expect(configUpdateCalls).toHaveLength(0);
  });
});

describe("getHashRegoSlugDrift", () => {
  it("returns empty for non-HASHREGO sources", async () => {
    const result = await getHashRegoSlugDrift({
      type: "HTML_SCRAPER",
      config: null,
      kennels: [],
    });
    expect(result).toEqual({ slugsWithoutLink: [], linksWithoutSlug: [] });
  });

  it("detects slugs without linked kennel (using alias resolution)", async () => {
    // "BFMH3" resolves to kennel k_bfm via alias, but k_bfm is not linked
    mockResolveKennelTag.mockImplementation(async (tag: string) => {
      if (tag === "BFMH3") return { kennelId: "k_bfm", matched: true };
      return { kennelId: null, matched: false };
    });

    const result = await getHashRegoSlugDrift({
      type: "HASHREGO",
      config: { kennelSlugs: ["BFMH3"] },
      kennels: [{ kennelId: "k_other", kennel: { shortName: "OTH3" } }],
    });
    expect(result.slugsWithoutLink).toEqual(["BFMH3"]);
    expect(result.linksWithoutSlug).toEqual(["OTH3"]);
  });

  it("returns no drift when slugs resolve to linked kennels", async () => {
    mockResolveKennelTag.mockImplementation(async (tag: string) => {
      if (tag === "BFMH3") return { kennelId: "k_bfm", matched: true };
      return { kennelId: null, matched: false };
    });

    const result = await getHashRegoSlugDrift({
      type: "HASHREGO",
      config: { kennelSlugs: ["BFMH3"] },
      kennels: [{ kennelId: "k_bfm", kennel: { shortName: "BFM" } }],
    });
    expect(result.slugsWithoutLink).toEqual([]);
    expect(result.linksWithoutSlug).toEqual([]);
  });

  it("detects unresolvable slugs as drift", async () => {
    mockResolveKennelTag.mockResolvedValue({ kennelId: null, matched: false });

    const result = await getHashRegoSlugDrift({
      type: "HASHREGO",
      config: { kennelSlugs: ["UNKNOWN"] },
      kennels: [],
    });
    expect(result.slugsWithoutLink).toEqual(["UNKNOWN"]);
  });

  it("rejects malformed kennelSlugs (not an array)", async () => {
    const result = await getHashRegoSlugDrift({
      type: "HASHREGO",
      config: { kennelSlugs: "not-an-array" },
      kennels: [],
    });
    // isHashRegoConfig should reject this, returning empty
    expect(result).toEqual({ slugsWithoutLink: [], linksWithoutSlug: [] });
  });
});
