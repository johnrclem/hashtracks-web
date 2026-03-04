import { describe, it, expect, vi, beforeEach } from "vitest";
import { mapWithConcurrency, researchSourcesForRegion, normalizeUrl, isBlocklistedDomain } from "./source-research";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    region: { findUnique: vi.fn() },
    kennel: { findMany: vi.fn() },
    kennelDiscovery: { findMany: vi.fn() },
    source: { findMany: vi.fn() },
    sourceProposal: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/source-detect", () => ({ detectSourceType: vi.fn() }));
vi.mock("@/lib/ai/gemini", () => ({ searchWithGemini: vi.fn() }));
vi.mock("@/pipeline/html-analysis", () => ({ analyzeUrlForProposal: vi.fn() }));

import { prisma } from "@/lib/db";
import { detectSourceType } from "@/lib/source-detect";
import { searchWithGemini } from "@/lib/ai/gemini";
import { analyzeUrlForProposal } from "@/pipeline/html-analysis";

const mockDetect = vi.mocked(detectSourceType);
const mockSearch = vi.mocked(searchWithGemini);
const mockAnalyze = vi.mocked(analyzeUrlForProposal);

// Prisma mock accessors
const regionFindUnique = prisma.region.findUnique as unknown as ReturnType<typeof vi.fn>;
const kennelFindMany = prisma.kennel.findMany as unknown as ReturnType<typeof vi.fn>;
const discoveryFindMany = prisma.kennelDiscovery.findMany as unknown as ReturnType<typeof vi.fn>;
const sourceFindMany = prisma.source.findMany as unknown as ReturnType<typeof vi.fn>;
const proposalFindMany = prisma.sourceProposal.findMany as unknown as ReturnType<typeof vi.fn>;
const proposalUpsert = prisma.sourceProposal.upsert as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

/** Set up default mock returns for a research pipeline test. Override specific mocks as needed. */
function setupResearchMocks(overrides?: {
  kennelsWithWebsites?: { id: string; shortName: string; website: string }[];
  existingSources?: { url: string }[];
}) {
  regionFindUnique.mockResolvedValue({ id: "r1", name: "Test Region" });
  kennelFindMany.mockImplementation(async (args: unknown) => {
    const where = (args as { where: { website?: unknown } }).where;
    if (where.website) {
      return overrides?.kennelsWithWebsites ?? [];
    }
    return [];
  });
  discoveryFindMany.mockResolvedValue([]);
  sourceFindMany.mockResolvedValue(overrides?.existingSources ?? []);
  proposalFindMany.mockResolvedValue([]);
  proposalUpsert.mockResolvedValue({});
  mockDetect.mockReturnValue(null);
  mockAnalyze.mockResolvedValue({
    candidates: [],
    suggestedConfig: null,
    explanation: "No containers found",
    confidence: null,
  });
}

describe("mapWithConcurrency", () => {
  it("processes all items", async () => {
    const items = [1, 2, 3, 4, 5];
    const results = await mapWithConcurrency(items, async (x) => x * 2, 2);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("respects concurrency limit", async () => {
    let maxConcurrent = 0;
    let current = 0;

    const items = [1, 2, 3, 4, 5];
    await mapWithConcurrency(items, async () => {
      current++;
      maxConcurrent = Math.max(maxConcurrent, current);
      await new Promise((r) => setTimeout(r, 10));
      current--;
    }, 2);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("handles empty array", async () => {
    const results = await mapWithConcurrency([], async (x: number) => x, 3);
    expect(results).toEqual([]);
  });
});

describe("normalizeUrl", () => {
  it("lowercases and strips trailing slashes", () => {
    expect(normalizeUrl("https://Example.COM/Path/")).toBe("https://example.com/path");
    expect(normalizeUrl("https://foo.com///")).toBe("https://foo.com");
    expect(normalizeUrl("https://foo.com")).toBe("https://foo.com");
  });
});

describe("isBlocklistedDomain", () => {
  it("blocks google.com and subdomains", () => {
    expect(isBlocklistedDomain("https://www.google.com/search?q=test")).toBe(true);
    expect(isBlocklistedDomain("https://maps.google.com/place")).toBe(true);
  });

  it("allows non-blocklisted domains", () => {
    expect(isBlocklistedDomain("https://hashnyc.com")).toBe(false);
  });

  it("does not match domain in path or query", () => {
    expect(isBlocklistedDomain("https://hashnyc.com/?ref=google.com")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(isBlocklistedDomain("not-a-url")).toBe(false);
  });
});

describe("researchSourcesForRegion", () => {
  it("returns error when region not found", async () => {
    regionFindUnique.mockResolvedValue(null);

    const result = await researchSourcesForRegion("bad-id");
    expect(result.errors).toContain("Region not found");
    expect(result.urlsDiscovered).toBe(0);
  });

  it("collects URLs from kennels with websites", async () => {
    setupResearchMocks({
      kennelsWithWebsites: [{ id: "k1", shortName: "TH3", website: "https://th3.com" }],
    });

    const result = await researchSourcesForRegion("r1");
    expect(result.urlsDiscovered).toBe(1);
    expect(result.proposalsCreated).toBe(1);
    expect(proposalUpsert).toHaveBeenCalledTimes(1);
  });

  it("deduplicates against existing sources and proposals", async () => {
    setupResearchMocks({
      kennelsWithWebsites: [
        { id: "k1", shortName: "TH3", website: "https://th3.com" },
        { id: "k2", shortName: "XH3", website: "https://existing.com" },
      ],
      existingSources: [{ url: "https://existing.com" }],
    });

    const result = await researchSourcesForRegion("r1");
    expect(result.urlsDiscovered).toBe(1);
  });

  it("uses detectSourceType for known URL patterns", async () => {
    setupResearchMocks({
      kennelsWithWebsites: [{ id: "k1", shortName: "TH3", website: "https://calendar.google.com/cal?src=abc" }],
    });
    mockDetect.mockReturnValue({ type: "GOOGLE_CALENDAR", extractedUrl: "abc" });

    const result = await researchSourcesForRegion("r1");
    expect(result.proposalsCreated).toBe(1);
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it("isolates errors per URL", async () => {
    setupResearchMocks({
      kennelsWithWebsites: [
        { id: "k1", shortName: "TH3", website: "https://good.com" },
        { id: "k2", shortName: "BH3", website: "https://bad.com" },
      ],
    });

    mockAnalyze
      .mockResolvedValueOnce({
        candidates: [{ containerSelector: "table", rowSelector: "tr", rowCount: 5, sampleRows: [], layoutType: "table" }],
        suggestedConfig: { containerSelector: "table", rowSelector: "tr", columns: { date: "td:nth-child(1)" } } as never,
        explanation: "Found table",
        confidence: "high",
      })
      .mockRejectedValueOnce(new Error("Connection refused"));

    const result = await researchSourcesForRegion("r1");
    expect(result.proposalsCreated).toBe(2);
  });
});
