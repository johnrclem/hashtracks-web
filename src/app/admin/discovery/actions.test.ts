import { describe, it, expect, vi, beforeEach } from "vitest";

// --- Mocks (before imports) ---

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findFirst: vi.fn(), update: vi.fn() },
    sourceKennel: { create: vi.fn(), upsert: vi.fn() },
    kennel: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    kennelAlias: { create: vi.fn() },
    kennelDiscovery: { findUnique: vi.fn(), update: vi.fn() },
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
vi.mock("@/pipeline/kennel-discovery", () => ({
  syncKennelDiscovery: vi.fn(),
}));
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
} from "./actions";

const mockAdmin = vi.mocked(getAdminUser);
const mockSourceFind = vi.mocked(prisma.source.findFirst);
const mockSourceKennelUpsert = vi.mocked(prisma.sourceKennel.upsert);
const mockKennelFind = vi.mocked(prisma.kennel.findUnique);
const mockDiscoveryFind = vi.mocked(prisma.kennelDiscovery.findUnique);
const mockDiscoveryUpdate = vi.mocked(prisma.kennelDiscovery.update);

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
