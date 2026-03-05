import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("@/lib/auth", () => ({ getAdminUser: vi.fn() }));

vi.mock("@/lib/db", () => {
  const proposalFindUnique = vi.fn();
  const proposalUpdate = vi.fn();
  const proposalUpdateMany = vi.fn();
  const sourceCreate = vi.fn();
  const sourceKennelCreate = vi.fn();
  const regionFindUnique = vi.fn();
  const regionFindFirst = vi.fn();

  // The $transaction mock passes the same prisma methods into the callback
  const txClient = {
    sourceProposal: { findUnique: proposalFindUnique, update: proposalUpdate },
    source: { create: sourceCreate },
    sourceKennel: { create: sourceKennelCreate },
  };

  return {
    prisma: {
      sourceProposal: {
        findUnique: proposalFindUnique,
        update: proposalUpdate,
        updateMany: proposalUpdateMany,
      },
      source: { create: sourceCreate },
      sourceKennel: { create: sourceKennelCreate },
      region: { findUnique: regionFindUnique, findFirst: regionFindFirst },
      $transaction: vi.fn((cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)),
    },
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/pipeline/source-research", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pipeline/source-research")>();
  return { ...actual, researchSourcesForRegion: vi.fn() };
});
vi.mock("@/lib/source-detect", () => ({ detectSourceType: vi.fn() }));
vi.mock("@/adapters/utils", () => ({ validateSourceUrl: vi.fn() }));
vi.mock("@/pipeline/html-analysis", () => ({
  analyzeUrlForProposal: vi.fn(),
  refineAnalysis: vi.fn(),
}));
vi.mock("@/lib/region", () => ({ regionSlug: vi.fn((s: string) => s.toLowerCase().replace(/\s+/g, "-")) }));
vi.mock("@/lib/kennel-utils", () => ({
  toSlug: vi.fn((s: string) => s.toLowerCase()),
  toKennelCode: vi.fn((s: string) => s.toLowerCase()),
}));
vi.mock("@/lib/auto-aliases", () => ({
  generateAliases: vi.fn(() => []),
  dedupeAliases: vi.fn((aliases: string[]) => aliases),
}));
vi.mock("@/pipeline/kennel-resolver", () => ({ clearResolverCache: vi.fn() }));
vi.mock("@/lib/safe-url", () => ({ safeUrl: vi.fn((v: string) => v || null) }));

import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { researchSourcesForRegion } from "@/pipeline/source-research";
import { detectSourceType } from "@/lib/source-detect";
import { validateSourceUrl } from "@/adapters/utils";
import { analyzeUrlForProposal, refineAnalysis } from "@/pipeline/html-analysis";

import {
  startRegionResearch,
  approveProposal,
  rejectProposal,
  bulkRejectProposals,
  updateProposalUrl,
  refineProposal,
} from "./actions";

// Cast mocks for type safety
const mockAuth = vi.mocked(getAdminUser);
const mockResearch = vi.mocked(researchSourcesForRegion);
const mockDetect = vi.mocked(detectSourceType);
const mockValidate = vi.mocked(validateSourceUrl);
const mockAnalyze = vi.mocked(analyzeUrlForProposal);
const mockRefine = vi.mocked(refineAnalysis);

// Prisma mock accessors (vi.fn() from mock factory)
const proposalFindUnique = prisma.sourceProposal.findUnique as unknown as ReturnType<typeof vi.fn>;
const proposalUpdate = prisma.sourceProposal.update as unknown as ReturnType<typeof vi.fn>;
const proposalUpdateMany = prisma.sourceProposal.updateMany as unknown as ReturnType<typeof vi.fn>;
const sourceCreate = prisma.source.create as unknown as ReturnType<typeof vi.fn>;
const sourceKennelCreate = prisma.sourceKennel.create as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ id: "admin1", email: "a@b.com" } as never);
});

describe("startRegionResearch", () => {
  it("requires admin auth", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await startRegionResearch("r1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("delegates to researchSourcesForRegion", async () => {
    // Mock the region lookup for resolveOrCreateRegion
    const regionFindUnique = prisma.region.findUnique as unknown as ReturnType<typeof vi.fn>;
    regionFindUnique.mockResolvedValue({ id: "r1" });

    mockResearch.mockResolvedValue({
      regionName: "NYC",
      kennelsDiscovered: 3,
      kennelsMatched: 1,
      urlsDiscovered: 5,
      urlsAnalyzed: 3,
      proposalsCreated: 3,
      proposalsSkipped: 0,
      errors: [],
      durationMs: 1000,
    });

    const result = await startRegionResearch("r1");
    expect(result).toMatchObject({ success: true, regionName: "NYC" });
    expect(mockResearch).toHaveBeenCalledWith("r1");
  });
});

describe("approveProposal", () => {
  it("requires admin auth", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await approveProposal("p1");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("creates Source and updates proposal", async () => {
    proposalFindUnique.mockResolvedValue({
      id: "p1",
      url: "https://example.com",
      detectedType: "HTML_SCRAPER",
      extractedConfig: { containerSelector: "table" },
      kennelId: "k1",
      sourceName: "Example Source",
      status: "PENDING",
    });
    sourceCreate.mockResolvedValue({ id: "s1" });
    sourceKennelCreate.mockResolvedValue({});
    proposalUpdate.mockResolvedValue({});

    const result = await approveProposal("p1");
    expect(result).toMatchObject({ success: true, sourceId: "s1" });
    expect(sourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: "https://example.com",
          type: "HTML_SCRAPER",
          enabled: true,
          trustLevel: 5,
        }),
      }),
    );
    expect(sourceKennelCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sourceId: "s1", kennelId: "k1" },
      }),
    );
  });

  it("applies overrides", async () => {
    proposalFindUnique.mockResolvedValue({
      id: "p1",
      url: "https://example.com",
      detectedType: "HTML_SCRAPER",
      extractedConfig: null,
      kennelId: null,
      sourceName: null,
      status: "PENDING",
    });
    sourceCreate.mockResolvedValue({ id: "s2" });
    proposalUpdate.mockResolvedValue({});

    const result = await approveProposal("p1", {
      name: "Custom Name",
      type: "GOOGLE_CALENDAR",
      config: '{"calendarId":"abc"}',
    });
    expect(result).toMatchObject({ success: true });
    expect(sourceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Custom Name",
          type: "GOOGLE_CALENDAR",
          url: "abc", // Calendar ID extracted as source URL
          config: { calendarId: "abc" },
        }),
      }),
    );
  });

  it("rejects already-approved proposals", async () => {
    proposalFindUnique.mockResolvedValue({ id: "p1", status: "APPROVED" });
    const result = await approveProposal("p1");
    expect(result).toEqual({ error: "Already approved" });
  });

  it("requires source type", async () => {
    proposalFindUnique.mockResolvedValue({ id: "p1", detectedType: null, status: "PENDING" });
    const result = await approveProposal("p1");
    expect(result).toEqual({ error: "Source type is required" });
  });
});

describe("rejectProposal", () => {
  it("updates proposal status to REJECTED", async () => {
    proposalUpdateMany.mockResolvedValue({ count: 1 });

    const result = await rejectProposal("p1");
    expect(result).toEqual({ success: true });
    expect(proposalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1", status: { in: ["PENDING", "ERROR"] } },
        data: expect.objectContaining({ status: "REJECTED" }),
      }),
    );
  });

  it("returns error if proposal already processed", async () => {
    proposalUpdateMany.mockResolvedValue({ count: 0 });

    const result = await rejectProposal("p1");
    expect(result).toEqual({ error: "Proposal already processed" });
  });
});

describe("bulkRejectProposals", () => {
  it("rejects multiple proposals", async () => {
    proposalUpdateMany.mockResolvedValue({ count: 3 });

    const result = await bulkRejectProposals(["p1", "p2", "p3"]);
    expect(result).toEqual({ success: true });
    expect(proposalUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ["p1", "p2", "p3"] }, status: { in: ["PENDING", "ERROR"] } },
      }),
    );
  });
});

describe("updateProposalUrl", () => {
  it("requires admin auth", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await updateProposalUrl("p1", "https://new.com");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("validates URL", async () => {
    mockValidate.mockImplementation(() => {
      throw new Error("SSRF blocked");
    });

    const result = await updateProposalUrl("p1", "http://localhost/evil");
    expect(result).toEqual({ error: "SSRF blocked" });
  });

  it("uses detectSourceType for known patterns", async () => {
    mockValidate.mockImplementation(() => {});
    mockDetect.mockReturnValue({ type: "GOOGLE_CALENDAR", extractedUrl: "cal-id" });
    proposalUpdate.mockResolvedValue({});

    const result = await updateProposalUrl("p1", "https://calendar.google.com/cal?src=abc");
    expect(result).toEqual({ success: true });
    expect(proposalUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          detectedType: "GOOGLE_CALENDAR",
          confidence: "high",
        }),
      }),
    );
  });

  it("falls back to HTML analysis", async () => {
    mockValidate.mockImplementation(() => {});
    mockDetect.mockReturnValue(null);
    mockAnalyze.mockResolvedValue({
      candidates: [],
      suggestedConfig: { containerSelector: "table", rowSelector: "tr", columns: { date: "td" } } as never,
      explanation: "Found table",
      confidence: "high",
    });
    proposalUpdate.mockResolvedValue({});

    const result = await updateProposalUrl("p1", "https://example.com/events");
    expect(result).toEqual({ success: true });
    expect(mockAnalyze).toHaveBeenCalledWith("https://example.com/events");
  });
});

describe("refineProposal", () => {
  it("requires admin auth", async () => {
    mockAuth.mockResolvedValue(null as never);
    const result = await refineProposal("p1", "fix columns");
    expect(result).toEqual({ error: "Not authorized" });
  });

  it("requires feedback text", async () => {
    const result = await refineProposal("p1", "  ");
    expect(result).toEqual({ error: "Feedback required" });
  });

  it("calls refineAnalysis with current config", async () => {
    proposalFindUnique.mockResolvedValue({
      id: "p1",
      url: "https://example.com",
      extractedConfig: { columns: { date: "td:nth-child(1)" } },
    });
    mockRefine.mockResolvedValue({
      candidates: [],
      suggestedConfig: { containerSelector: "table", rowSelector: "tr", columns: { date: "td:nth-child(1)", location: "td:nth-child(3)" } } as never,
      explanation: "Adjusted per feedback",
      confidence: "high",
    });
    proposalUpdate.mockResolvedValue({});

    const result = await refineProposal("p1", "location is in column 3");
    expect(result).toEqual({ success: true });
    expect(mockRefine).toHaveBeenCalledWith(
      "https://example.com",
      { columns: { date: "td:nth-child(1)" } },
      "location is in column 3",
    );
  });
});
