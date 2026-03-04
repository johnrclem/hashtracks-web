import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// --- Mocks (before imports) ---

vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    source: { findFirst: vi.fn(), update: vi.fn() },
    sourceKennel: { create: vi.fn() },
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
const mockSourceUpdate = vi.mocked(prisma.source.update);
const mockSourceKennelCreate = vi.mocked(prisma.sourceKennel.create);
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
    mockSourceUpdate.mockResolvedValue({} as never);
    mockSourceKennelCreate.mockResolvedValue({} as never);
  });

  it("adds slug to Hash Rego source config and creates SourceKennel", async () => {
    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });

    // Source config updated with new slug
    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "src-hr" },
        data: {
          config: { kennelSlugs: ["BFM", "EWH3", "NewH3"] },
        },
      }),
    );

    // SourceKennel join created
    expect(mockSourceKennelCreate).toHaveBeenCalledWith({
      data: { sourceId: "src-hr", kennelId: "kennel-1" },
    });
  });

  it("skips slug addition if already present in config", async () => {
    mockSourceFind.mockResolvedValue({
      id: "src-hr",
      config: { kennelSlugs: ["BFM", "NewH3"] },
    } as never);

    await linkDiscoveryToKennel("disc-1", "kennel-1");

    // Source.update should NOT be called (slug already present)
    expect(mockSourceUpdate).not.toHaveBeenCalled();
    // SourceKennel should still be created
    expect(mockSourceKennelCreate).toHaveBeenCalled();
  });

  it("handles P2002 on duplicate SourceKennel gracefully", async () => {
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      { code: "P2002", clientVersion: "0.0.0" },
    );
    mockSourceKennelCreate.mockRejectedValue(p2002);

    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });
  });

  it("is a no-op if no HASHREGO source exists", async () => {
    mockSourceFind.mockResolvedValue(null as never);

    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });
    expect(mockSourceUpdate).not.toHaveBeenCalled();
    expect(mockSourceKennelCreate).not.toHaveBeenCalled();
  });

  it("handles null source config", async () => {
    mockSourceFind.mockResolvedValue({
      id: "src-hr",
      config: null,
    } as never);

    await linkDiscoveryToKennel("disc-1", "kennel-1");

    expect(mockSourceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { config: { kennelSlugs: ["NewH3"] } },
      }),
    );
  });
});

// ---- addKennelFromDiscovery ----

describe("addKennelFromDiscovery", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeDiscovery as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceUpdate.mockResolvedValue({} as never);
    mockSourceKennelCreate.mockResolvedValue({} as never);
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
      select: { id: true, config: true },
    });
    expect(mockSourceKennelCreate).toHaveBeenCalledWith({
      data: { sourceId: "src-hr", kennelId: "new-kennel-1" },
    });
  });

  it("is a no-op for source linking if no HASHREGO source", async () => {
    mockSourceFind.mockResolvedValue(null as never);

    const result = await addKennelFromDiscovery("disc-1", {
      shortName: "NewH3",
      fullName: "New Hash House Harriers",
      regionId: "region-1",
    });

    expect(result).toEqual({ success: true, kennelId: "new-kennel-1" });
    expect(mockSourceUpdate).not.toHaveBeenCalled();
    expect(mockSourceKennelCreate).not.toHaveBeenCalled();
  });
});

// ---- confirmMatch ----

describe("confirmMatch", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeMatchedDiscovery as never);
    mockKennelFind.mockResolvedValue(fakeKennel as never);
    mockDiscoveryUpdate.mockResolvedValue({} as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    mockSourceUpdate.mockResolvedValue({} as never);
    mockSourceKennelCreate.mockResolvedValue({} as never);
  });

  it("links matched kennel to Hash Rego source on confirm", async () => {
    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ success: true });

    expect(mockSourceFind).toHaveBeenCalledWith({
      where: { type: "HASHREGO" },
      select: { id: true, config: true },
    });
    expect(mockSourceKennelCreate).toHaveBeenCalledWith({
      data: { sourceId: "src-hr", kennelId: "kennel-1" },
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
