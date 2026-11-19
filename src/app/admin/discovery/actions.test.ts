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
    region: { findUnique: vi.fn(), findMany: vi.fn() },
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
  getDiscoveryPrefill,
} from "./actions";
import { matchesWhere } from "@/test/prisma-where";

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
  externalSource: "HASHREGO",
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
  });

  it("records identity only: row LINKED, no scrape link, no alias", async () => {
    const result = await linkDiscoveryToKennel("disc-1", "kennel-1");
    expect(result).toEqual({ success: true });

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith({
      where: { id: "disc-1" },
      data: expect.objectContaining({ status: "LINKED", matchedKennelId: "kennel-1", processedBy: "admin-1" }),
    });
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
    expect(mockKennelAliasCreate).not.toHaveBeenCalled();
  });

  it("refuses an unknown kennel", async () => {
    mockKennelFind.mockResolvedValue(null as never);
    expect(await linkDiscoveryToKennel("disc-1", "nope")).toEqual({ error: "Kennel not found" });
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
  });
});

// ---- addKennelFromDiscovery ----

describe("addKennelFromDiscovery", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeDiscovery as never);
  });

  it("creates the kennel without linking it to the Hash Rego scraper", async () => {
    const result = await addKennelFromDiscovery("disc-1", {
      shortName: "NewH3",
      fullName: "New Hash House Harriers",
      regionId: "region-1",
    });

    expect(result).toEqual({ success: true, kennelId: "new-kennel-1" });
    expect(mockSourceFind).not.toHaveBeenCalled();
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
  });
});

// ---- confirmMatch ----

describe("confirmMatch", () => {
  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(fakeMatchedDiscovery as never);
    mockDiscoveryUpdate.mockResolvedValue({} as never);
  });

  it("marks the suggestion LINKED without a scrape link or alias", async () => {
    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ success: true });

    expect(mockDiscoveryUpdate).toHaveBeenCalledWith({
      where: { id: "disc-2" },
      data: expect.objectContaining({ status: "LINKED" }),
    });
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
    expect(mockKennelAliasCreate).not.toHaveBeenCalled();
  });

  it("rejects non-MATCHED discoveries", async () => {
    mockDiscoveryFind.mockResolvedValue({
      ...fakeMatchedDiscovery,
      status: "NEW",
    } as never);

    const result = await confirmMatch("disc-2");
    expect(result).toEqual({ error: "Can only confirm MATCHED discoveries" });
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
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
  });

  it("only reviews the row: a scraped account keeps its link", async () => {
    mockDiscoveryFind.mockResolvedValue({ externalSource: "HASHREGO" } as never);

    const result = await dismissDiscovery("disc-2");
    expect(result).toEqual({ success: true });
    expect(mockDiscoveryUpdate).toHaveBeenCalledWith({
      where: { id: "disc-2" },
      data: expect.objectContaining({ status: "DISMISSED", processedBy: "admin-1" }),
    });
    expect(mockSourceKennelDeleteMany).not.toHaveBeenCalled();
  });

  it("returns an error for a missing row", async () => {
    mockDiscoveryFind.mockResolvedValue(null as never);
    expect(await dismissDiscovery("gone")).toEqual({ error: "Discovery not found" });
  });
});

// ---- bulkDismissDiscoveries ----

describe("bulkDismissDiscoveries", () => {
  it("dismisses the rows without touching scrape links", async () => {
    mockDiscoveryUpdateMany.mockResolvedValue({ count: 2 } as never);

    expect(await bulkDismissDiscoveries(["a", "b"])).toEqual({ success: true });
    expect(mockDiscoveryUpdateMany).toHaveBeenCalledTimes(1);
    expect(mockSourceKennelDeleteMany).not.toHaveBeenCalled();
  });
});

// ---- Gemini rows are research suggestions, not Hash Rego accounts ----

describe("Hash Rego actions refuse Gemini rows", () => {
  const geminiRow = { ...fakeMatchedDiscovery, externalSource: "GEMINI", externalSlug: "black-sheep-hhh" };
  beforeEach(() => mockDiscoveryFind.mockResolvedValue(geminiRow as never));
  const refusal = { error: expect.stringContaining("Hash Rego rows only") };

  it("linkDiscoveryToKennel refuses", async () => {
    expect(await linkDiscoveryToKennel("disc-2", "kennel-1")).toEqual(refusal);
  });
  it("confirmMatch refuses", async () => {
    expect(await confirmMatch("disc-2")).toEqual(refusal);
  });
  it("addKennelFromDiscovery refuses", async () => {
    expect(await addKennelFromDiscovery("disc-2", { shortName: "B", fullName: "B", regionId: "r" })).toEqual(refusal);
  });
  it("getDiscoveryPrefill refuses", async () => {
    vi.mocked(prisma.region.findMany).mockResolvedValue([] as never);
    expect(await getDiscoveryPrefill("disc-2")).toEqual(refusal);
  });
});

// ---- Half-Mind rows are off limits to the Hash Rego actions ----

describe("Hash Rego actions refuse Half-Mind rows", () => {
  const halfMindRow = {
    ...fakeDiscovery,
    id: "disc-hm",
    externalSource: "HALFMIND",
    externalSlug: "19",
    status: "MATCHED",
    matchedKennelId: "kennel-1",
  };
  const refusal = { error: "Use the Half-Mind actions for Half-Mind rows." };

  beforeEach(() => {
    mockDiscoveryFind.mockResolvedValue(halfMindRow as never);
    mockKennelFind.mockResolvedValue(fakeKennel as never);
    mockSourceFind.mockResolvedValue(fakeHashRegoSource as never);
    vi.mocked(prisma.region.findMany).mockResolvedValue([] as never);
  });

  function expectNothingWritten() {
    expect(mockSourceKennelUpsert).not.toHaveBeenCalled();
    expect(mockKennelAliasCreate).not.toHaveBeenCalled();
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  }

  it("linkDiscoveryToKennel refuses", async () => {
    expect(await linkDiscoveryToKennel("disc-hm", "kennel-1")).toEqual(refusal);
    expectNothingWritten();
  });

  it("addKennelFromDiscovery refuses", async () => {
    expect(
      await addKennelFromDiscovery("disc-hm", { shortName: "PFH3", fullName: "Peach Fuzz H3", regionId: "region-1" }),
    ).toEqual(refusal);
    expectNothingWritten();
  });

  it("confirmMatch refuses", async () => {
    expect(await confirmMatch("disc-hm")).toEqual(refusal);
    expectNothingWritten();
  });

  it("getDiscoveryPrefill refuses", async () => {
    expect(await getDiscoveryPrefill("disc-hm")).toEqual(refusal);
  });

  it("dismissDiscovery refuses a Half-Mind row that isn't NEW", async () => {
    mockDiscoveryFind.mockResolvedValue({ id: "disc-hm", status: "LINKED", matchedKennelId: "kennel-1", externalSource: "HALFMIND" } as never);
    expect(await dismissDiscovery("disc-hm")).toEqual({ error: "Only a NEW Half-Mind row can be dismissed." });
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
  });

  it("dismissDiscovery dismisses a NEW Half-Mind row only while it is still NEW", async () => {
    mockDiscoveryFind.mockResolvedValue({ id: "disc-hm", status: "NEW", matchedKennelId: null, externalSource: "HALFMIND" } as never);
    mockDiscoveryUpdateMany.mockResolvedValue({ count: 1 } as never);
    expect(await dismissDiscovery("disc-hm")).toEqual({ success: true });
    expect(mockDiscoveryUpdateMany).toHaveBeenCalledWith({
      where: { id: "disc-hm", status: "NEW" },
      data: { status: "DISMISSED", processedBy: "admin-1", processedAt: expect.any(Date) },
    });
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
  });

  it("dismissDiscovery refuses when a Half-Mind link landed after the row was read", async () => {
    mockDiscoveryFind.mockResolvedValue({ id: "disc-hm", status: "NEW", matchedKennelId: null, externalSource: "HALFMIND" } as never);
    mockDiscoveryUpdateMany.mockResolvedValue({ count: 0 } as never);
    expect(await dismissDiscovery("disc-hm")).toEqual({ error: "Only a NEW Half-Mind row can be dismissed." });
    expect(mockDiscoveryUpdate).not.toHaveBeenCalled();
  });

  it("bulkDismissDiscoveries skips LINKED and ADDED Half-Mind rows", async () => {
    mockDiscoveryFindMany.mockResolvedValue([] as never);
    mockDiscoveryUpdateMany.mockResolvedValue({ count: 3 } as never);
    const rows = [
      { id: "a", externalSource: "HASHREGO", status: "NEW" },
      { id: "b", externalSource: "HALFMIND", status: "LINKED" },
      { id: "c", externalSource: "HALFMIND", status: "ADDED" },
      { id: "d", externalSource: "HALFMIND", status: "NEW" },
      { id: "e", externalSource: "HASHREGO", status: "LINKED" },
    ];

    await bulkDismissDiscoveries(rows.map((r) => r.id));

    const { where } = mockDiscoveryUpdateMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(rows.filter((r) => matchesWhere(r, where)).map((r) => r.id)).toEqual(["a", "d", "e"]);
  });
});
