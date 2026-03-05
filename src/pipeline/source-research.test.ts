import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mapWithConcurrency, researchSourcesForRegion, normalizeUrl, isBlocklistedDomain, parseGeminiSearchResults, checkUrlReachability } from "./source-research";
import { discoverEmbeddedSources } from "./html-analysis";
import * as cheerio from "cheerio";

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

vi.mock("@/lib/source-detect", () => ({
  detectSourceType: vi.fn(),
  extractCalendarId: vi.fn(),
}));
vi.mock("@/lib/ai/gemini", () => ({ searchAndExtract: vi.fn() }));
vi.mock("@/pipeline/html-analysis", async () => {
  const actual = await vi.importActual<typeof import("@/pipeline/html-analysis")>("@/pipeline/html-analysis");
  return {
    ...actual,
    analyzeUrlForProposal: vi.fn(),
  };
});
vi.mock("@/pipeline/kennel-discovery-ai", async () => {
  const actual = await vi.importActual<typeof import("@/pipeline/kennel-discovery-ai")>("@/pipeline/kennel-discovery-ai");
  return {
    ...actual,
    discoverKennelsForRegion: vi.fn().mockResolvedValue({
      discovered: 0,
      matched: 0,
      skipped: 0,
      errors: [],
    }),
  };
});

import { prisma } from "@/lib/db";
import { detectSourceType } from "@/lib/source-detect";
import { searchAndExtract } from "@/lib/ai/gemini";
import { analyzeUrlForProposal } from "@/pipeline/html-analysis";

const mockDetect = vi.mocked(detectSourceType);
const mockAnalyze = vi.mocked(analyzeUrlForProposal);
const mockSearchAndExtract = vi.mocked(searchAndExtract);

// Prisma mock accessors
const regionFindUnique = prisma.region.findUnique as unknown as ReturnType<typeof vi.fn>;
const kennelFindMany = prisma.kennel.findMany as unknown as ReturnType<typeof vi.fn>;
const discoveryFindMany = prisma.kennelDiscovery.findMany as unknown as ReturnType<typeof vi.fn>;
const sourceFindMany = prisma.source.findMany as unknown as ReturnType<typeof vi.fn>;
const proposalFindMany = prisma.sourceProposal.findMany as unknown as ReturnType<typeof vi.fn>;
const proposalUpsert = prisma.sourceProposal.upsert as unknown as ReturnType<typeof vi.fn>;

// Mock global fetch for URL reachability checks (HEAD requests)
const originalFetch = global.fetch;
beforeEach(() => {
  vi.clearAllMocks();
  // Default: all HEAD requests succeed (reachable)
  global.fetch = vi.fn().mockResolvedValue({ status: 200 }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
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

describe("parseGeminiSearchResults", () => {
  it("parses clean JSON array", () => {
    const text = JSON.stringify([{ kennel: "TH3", url: "https://th3.com/events" }]);
    const results = parseGeminiSearchResults(text, [{ id: "k1", shortName: "TH3" }], "query");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://th3.com/events");
    expect(results[0].kennelId).toBe("k1");
  });

  it("extracts JSON from natural language prose", () => {
    const text = `Based on my search, here are the results:\n[{"kennel":"TH3","url":"https://th3.com"}]\nThese are the most relevant.`;
    const results = parseGeminiSearchResults(text, [{ id: "k1", shortName: "TH3" }], "query");
    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://th3.com");
  });

  it("extracts JSON from code-fenced prose", () => {
    const text = "Here are URLs:\n```json\n[{\"kennel\":\"XH3\",\"url\":\"https://xh3.com\"}]\n```\nLet me know if you need more.";
    const results = parseGeminiSearchResults(text, [], "query");
    expect(results).toHaveLength(1);
  });

  it("skips entries without valid URLs", () => {
    const text = JSON.stringify([
      { kennel: "TH3", url: "https://valid.com" },
      { kennel: "BH3", url: "not-a-url" },
      { kennel: "CH3" },
    ]);
    const results = parseGeminiSearchResults(text, [], "query");
    expect(results).toHaveLength(1);
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

  it("web-searches for discovered kennels without websites", async () => {
    setupResearchMocks();
    // Override discoveryFindMany to return websiteless discoveries on the 5th query
    discoveryFindMany.mockImplementation(async (args: unknown) => {
      const where = (args as { where: { website?: unknown; status?: unknown } }).where;
      // 5th query: status IN [NEW, MATCHED], website null
      if (where.website === null && where.status) {
        return [{ name: "El Paso HHH" }];
      }
      return [];
    });

    mockSearchAndExtract.mockResolvedValue({
      text: JSON.stringify([{ kennel: "El Paso HHH", url: "https://eph3.com/hareline" }]),
      groundingUrls: [],
      error: undefined,
      durationMs: 100,
    });

    const result = await researchSourcesForRegion("r1");
    expect(result.urlsDiscovered).toBe(1);
    expect(mockSearchAndExtract).toHaveBeenCalled();
    expect(proposalUpsert).toHaveBeenCalledTimes(1);
  });

  it("filters out unreachable URLs", async () => {
    setupResearchMocks({
      kennelsWithWebsites: [
        { id: "k1", shortName: "TH3", website: "https://reachable.com" },
        { id: "k2", shortName: "BH3", website: "https://fake-domain-xyz.com" },
      ],
    });

    // Mock fetch: reachable.com returns 200, fake returns error
    (global.fetch as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("fake-domain-xyz")) {
        throw new Error("DNS resolution failed");
      }
      return { status: 200 };
    });

    const result = await researchSourcesForRegion("r1");
    expect(result.urlsDiscovered).toBe(1); // Only the reachable one
  });
});

describe("checkUrlReachability", () => {
  it("returns true for 2xx responses", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 200 });
    expect(await checkUrlReachability("https://example.com")).toBe(true);
  });

  it("returns true for 3xx redirects", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 301 });
    expect(await checkUrlReachability("https://example.com")).toBe(true);
  });

  it("returns false for 404", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 404 });
    expect(await checkUrlReachability("https://example.com")).toBe(false);
  });

  it("returns false on network error", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await checkUrlReachability("https://bad.com")).toBe(false);
  });
});

describe("discoverEmbeddedSources", () => {
  it("finds Google Calendar links", () => {
    const $ = cheerio.load(`
      <html><body>
        <a href="https://calendar.google.com/calendar/embed?src=test@gmail.com&ctz=America/Denver">Calendar</a>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("calendar.google.com");
    expect(urls[0]).toContain("test@gmail.com");
  });

  it("finds Google Calendar iframes", () => {
    const $ = cheerio.load(`
      <html><body>
        <iframe src="https://calendar.google.com/calendar/embed?src=abc@group.calendar.google.com"></iframe>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("calendar.google.com");
  });

  it("finds iCal feed links", () => {
    const $ = cheerio.load(`
      <html><body>
        <a href="https://example.com/events.ics">Download Calendar</a>
        <a href="webcal://example.com/feed.ics">Subscribe</a>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(2);
  });

  it("finds Google Sheets links", () => {
    const $ = cheerio.load(`
      <html><body>
        <a href="https://docs.google.com/spreadsheets/d/abc123/edit">Hareline Spreadsheet</a>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("docs.google.com/spreadsheets");
  });

  it("finds Meetup links", () => {
    const $ = cheerio.load(`
      <html><body>
        <a href="https://www.meetup.com/some-hash-group/">Meetup Page</a>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("meetup.com");
  });

  it("finds calendar URLs in script tags", () => {
    const $ = cheerio.load(`
      <html><body>
        <script>
          var calUrl = "https://calendar.google.com/calendar/embed?src=myhash@gmail.com&ctz=US";
        </script>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("calendar.google.com/calendar/embed");
  });

  it("deduplicates URLs", () => {
    const $ = cheerio.load(`
      <html><body>
        <a href="https://calendar.google.com/calendar/embed?src=x@gmail.com">Link 1</a>
        <a href="https://calendar.google.com/calendar/embed?src=x@gmail.com">Link 2</a>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(1);
  });

  it("returns empty for pages with no embedded sources", () => {
    const $ = cheerio.load(`
      <html><body>
        <h1>Welcome to our hash</h1>
        <p>Join us for a run!</p>
      </body></html>
    `);
    const urls = discoverEmbeddedSources($);
    expect(urls).toHaveLength(0);
  });
});
