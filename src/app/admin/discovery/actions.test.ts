import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (before imports) ---

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findFirst: vi.fn(), update: vi.fn() },
    sourceKennel: { create: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    kennel: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    kennelAlias: { create: vi.fn() },
    kennelDiscovery: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    region: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        kennel: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: "new-kennel-1" }),
        },
        kennelDiscovery: { update: vi.fn() },
        region: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ name: "NYC Metro", country: "USA" }),
        },
      }),
    ),
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/pipeline/kennel-resolver", () => ({ clearResolverCache: vi.fn() }));
vi.mock("@/pipeline/kennel-discovery", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pipeline/kennel-discovery")>();
  return {
    ...actual,
    syncKennelDiscovery: vi.fn(),
  };
});
vi.mock("@/lib/kennel-utils", () => ({
  toSlug: vi.fn((s: string) => s.toLowerCase()),
  toKennelCode: vi.fn((s: string) => s.toUpperCase()),
}));
vi.mock("@/lib/auto-aliases", () => ({
  generateAliases: vi.fn(() => []),
  dedupeAliases: vi.fn((aliases: string[]) => aliases),
}));
vi.mock("@/adapters/hashrego/kennel-api", () => ({
  normalizeTrailDay: vi.fn(),
}));
vi.mock("@/lib/safe-url", () => ({
  safeUrl: vi.fn((u?: string) => u || null),
}));

// --- Imports ---

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  linkDiscoveryToKennel,
  addKennelFromDiscovery,
  confirmMatch,
  dismissDiscovery,
  bulkDismissDiscoveries,
} from "./actions";

const mockAdmin = vi.mocked(getAdminUser);
const mockSourceFind = vi.mocked(prisma.source.findFirst);
const mockSourceKennelUpsert = vi.mocked(prisma.sourceKennel.upsert);
const mockSourceKennelDeleteMany = vi.mocked(prisma.sourceKennel.deleteMany);
const mockKennelFind = vi.mocked(prisma.kennel.findUnique);
const mockKennelAliasCreate = vi.mocked(prisma.kennelAlias.create);
const mockDiscoveryFind = vi.mocked(prisma.kennelDiscovery.findUnique);
const mockDiscoveryFindMany = vi.mocked(prisma.kennelDiscovery.findMany);
const mockDiscoveryUpdate = vi.mocked(prisma.kennelDiscovery.update);
const mockDiscoveryUpdateMany = vi.mocked(prisma.kennelDiscovery.updateMany);

const fakeAdmin = { id: "admin-1" };

const fakeDiscovery = {
  id: "disc-1",
  externalSlug: "NewH3",
  name: "New Hash House Harriers",
  status: "NEW",
  matchedKennelId: null,
  website: null,
  contactEmail: null,
  yearStarted: null,
  trailPrice: null,
  schedule: null,
  location: null,
  paymentInfo: null,
};

const fakeMatchedDiscovery = {
  ...fakeDiscovery,
  id: "disc-2",
  status: "MATCHED",
  matchedKennelId: "kennel-1",
};

const fakeKennel = { id: "kennel-1", shortName: "ExistingH3" };

const fakeHashRegoSource = {
  id: "src-hr",
  config: { kennelSlugs: ["BFM", "EWH3"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAdmin.mockResolvedValue(fakeAdmin as never);
});

// ---- linkDiscoveryToKennel ----

describe("linkDiscoveryToKennel", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeDiscovery as never);
    mockKennelFind.mockResolvedValue(fakeKennel as never);
    mockDiscoveryUpdate.mockResolvedValue({} as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceKennelUpsert.mockResolvedValue({} as never);
  });

  it("upserts SourceKennel with externalSlug", async () => {
    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });

    // SourceKennel upserted with externalSlug
    expect(mockSourceKennelUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "src-hr", kennelId: "kennel-1" } },
      update: { externalSlug: "NewH3" },
      create: { sourceId: "src-hr", kennelId: "kennel-1", externalSlug: "NewH3" },
    });
  });

  it("creates KennelAlias when slug differs from kennel shortName", async () => {
    // fakeDiscovery.externalSlug = "NewH3", fakeKennel.shortName = "ExistingH3"
    await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(mockKennelAliasCreate).toHaveBeenCalledWith({
      data: { kennelId: "kennel-1", alias: "NewH3" },
    });
  });

  it("does not create KennelAlias when slug matches kennel shortName", async () => {
    mockKennelFind.mockResolvedValue({ id: "kennel-1", shortName: "NewH3" } as never);
    await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(mockKennelAliasCreate).not.toHaveBeenCalled();
  });

  it("handles duplicate SourceKennel via upsert (no P2002)", async () => {
    // upsert is idempotent — no error even if record exists
    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });
  });

  it("is a no-op if no HASHREGO source exists", async () => {
    mockSourceFind.mockResolvedValue(null as never);

    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
  });
});

// ---- addKennelFromDiscovery ----

describe("addKennelFromDiscovery", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeDiscovery as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceKennelUpsert.mockResolvedValue({} as never);
  });

  it("links new kennel to Hash Rego source after creation", async () => {
    const result = await addKennelFromDiscovery("disc-1", {
      shortName: "NewH3",
      fullName: "New Hash House Harriers",
      regionId: "region-1",
    });

    expect(result).toEqual({ success: true, kennelId: "new-kennel-1" });

    // Should have linked to Hash Rego source with the new kennel ID
    expect(mockSourceFind).toHaveBeenCalledWith({
      where: { type: "HASHREGO" },
      select: { id: true },
    });
    expect(mockSourceKennelUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "src-hr", kennelId: "new-kennel-1" } },
      update: { externalSlug: "NewH3" },
      create: { sourceId: "src-hr", kennelId: "new-kennel-1", externalSlug: "NewH3" },
    });
  });

  it("succeeds even if source linking throws", async () => {
    mockSourceFind.mockRejectedValue(new Error("DB timeout"));

    const result = await addKennelFromDiscovery("disc-1", {
      shortName: "NewH3",
      fullName: "New Hash House Harriers",
      regionId: "region-1",
    });

    // Kennel creation succeeded despite linking failure
    expect(result).toEqual({ success: true, kennelId: "new-kennel-1" });
  });

  it("is a no-op for source linking if no HASHREGO source", async () => {
    mockSourceFind.mockResolvedValue(null as never);

    const result = await addKennelFromDiscovery("disc-1", {
      shortName: "NewH3",
      fullName: "New Hash House Harriers",
      regionId: "region-1",
    });

    expect(result).toEqual({ success: true, kennelId: "new-kennel-1" });
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
  });
});

// ---- confirmMatch ----

describe("confirmMatch", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeMatchedDiscovery as never);
    mockKennelFind.mockResolvedValue(fakeKennel as never);
    mockDiscoveryUpdate.mockResolvedValue({} as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceKennelUpsert.mockResolvedValue({} as never);
  });

  it("links matched kennel to Hash Rego source on confirm", async () => {
    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ success: true });

    expect(mockSourceFind).toHaveBeenCalledWith({
      where: { type: "HASHREGO" },
      select: { id: true },
    });
    expect(mockSourceKennelUpsert).toHaveBeenCalledWith({
      where: { sourceId_kennelId: { sourceId: "src-hr", kennelId: "kennel-1" } },
      update: { externalSlug: "NewH3" },
      create: { sourceId: "src-hr", kennelId: "kennel-1", externalSlug: "NewH3" },
    });
  });

  it("creates KennelAlias when confirming a slug that differs from shortName", async () => {
    await confirmMatch("disc-2");
    expect(mockKennelAliasCreate).toHaveBeenCalledWith({
      data: { kennelId: "kennel-1", alias: "NewH3" },
    });
  });

  it("does not create KennelAlias when confirmed slug matches shortName", async () => {
    mockKennelFind.mockResolvedValue({ id: "kennel-1", shortName: "NewH3" } as never);
    await confirmMatch("disc-2");
    expect(mockKennelAliasCreate).not.toHaveBeenCalled();
  });

  it("rejects non-MATCHED discoveries", async () => {
    mockDiscoveryFind.mockResolvedValue({
      ...fakeMatchedDiscovery,
      status: "NEW",
    } as never);

    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ error: "Can only confirm MATCHED discoveries" });

    expect(mockSourceFind).not.toHaveBeenCalled();
  });

  it("handles missing matched kennel ID", async () => {
    mockDiscoveryFind.mockResolvedValue({
      ...fakeMatchedDiscovery,
      matchedKennelId: null,
    } as never);

    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ error: "No matched kennel" });
  });
});

// ---- dismissDiscovery ----

describe("dismissDiscovery", () => {
  beforeEach(() => {
    mockDiscoveryUpdate.mockResolvedValue({} as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceKennelDeleteMany.mockResolvedValue({ count: 1 } as never);
  });

  it("deletes stale SourceKennel when dismissing a MATCHED discovery", async () => {
    mockDiscoveryFind.mockResolvedValue({
      status: "MATCHED",
      matchedKennelId: "kennel-1",
    } as never);

    const result = await dismissDiscovery("disc-2");
    expect(result).toEqual({ success: true });

    expect(mockSourceKennelDeleteMany).toHaveBeenCalledWith({
      where: { sourceId: "src-hr", kennelId: "kennel-1" },
    });
  });

  it("does NOT delete SourceKennel when dismissing a LINKED discovery", async () => {
    // Admin-confirmed links must survive a later dismissal — the scraper
    // routing stays in place and only the discovery row flips.
    mockDiscoveryFind.mockResolvedValue({
      status: "LINKED",
      matchedKennelId: "kennel-1",
    } as never);

    await dismissDiscovery("disc-3");
    expect(mockSourceKennelDeleteMany).not.toHaveBeenCalled();
  });

  it("does NOT delete SourceKennel when dismissing a NEW discovery", async () => {
    mockDiscoveryFind.mockResolvedValue({
      status: "NEW",
      matchedKennelId: null,
    } as never);

    await dismissDiscovery("disc-4");
    expect(mockSourceKennelDeleteMany).not.toHaveBeenCalled();
  });
});

// ---- bulkDismissDiscoveries ----

describe("bulkDismissDiscoveries", () => {
  beforeEach(() => {
    mockDiscoveryUpdateMany.mockResolvedValue({ count: 0 } as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceKennelDeleteMany.mockResolvedValue({ count: 0 } as never);
  });

  it("deletes SourceKennel only for MATCHED rows in a mixed batch", async () => {
    mockDiscoveryFindMany.mockResolvedValue([
      { status: "MATCHED", matchedKennelId: "k1" },
      { status: "NEW", matchedKennelId: null },
      { status: "MATCHED", matchedKennelId: "k2" },
      { status: "LINKED", matchedKennelId: "k3" }, // admin-confirmed, preserved
    ] as never);

    await bulkDismissDiscoveries(["a", "b", "c", "d"]);

    expect(mockSourceKennelDeleteMany).toHaveBeenCalledWith({
      where: { sourceId: "src-hr", kennelId: { in: ["k1", "k2"] } },
    });
  });

  it("skips SourceKennel delete when no MATCHED rows in the batch", async () => {
    mockDiscoveryFindMany.mockResolvedValue([
      { status: "NEW", matchedKennelId: null },
      { status: "LINKED", matchedKennelId: "k1" },
    ] as never);

    await bulkDismissDiscoveries(["a", "b"]);
    expect(mockSourceKennelDeleteMany).not.toHaveBeenCalled();
  });
});
