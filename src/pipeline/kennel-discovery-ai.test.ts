import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  discoverKennelsForRegion,
  buildSearchPrompt,
  buildExtractionPrompt,
  parseDiscoveryResponse,
  extractJsonArray,
} from "./kennel-discovery-ai";

// Mock dependencies
vi.mock("@/lib/db", () => ({
  prisma: {
    region: { findUnique: vi.fn() },
    kennel: { findMany: vi.fn() },
    kennelDiscovery: { findMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("@/lib/ai/gemini", () => ({ searchAndExtract: vi.fn() }));

import { prisma } from "@/lib/db";
import { searchAndExtract } from "@/lib/ai/gemini";

const regionFindUnique = prisma.region.findUnique as unknown as ReturnType<typeof vi.fn>;
const kennelFindMany = prisma.kennel.findMany as unknown as ReturnType<typeof vi.fn>;
const discoveryFindMany = prisma.kennelDiscovery.findMany as unknown as ReturnType<typeof vi.fn>;
const discoveryUpsert = prisma.kennelDiscovery.upsert as unknown as ReturnType<typeof vi.fn>;
const mockSearchAndExtract = vi.mocked(searchAndExtract);

beforeEach(() => {
  vi.clearAllMocks();
});

function setupMocks(overrides?: {
  existingKennels?: { id: string; shortName: string; fullName: string; aliases: { alias: string }[] }[];
  existingDiscoveries?: { externalSlug: string }[];
}) {
  regionFindUnique.mockResolvedValue({ id: "r1", name: "Test Region" });
  kennelFindMany.mockResolvedValue(overrides?.existingKennels ?? []);
  discoveryFindMany.mockResolvedValue(overrides?.existingDiscoveries ?? []);
  discoveryUpsert.mockResolvedValue({});
}

describe("buildSearchPrompt", () => {
  it("includes region name", () => {
    const prompt = buildSearchPrompt("New Jersey");
    expect(prompt).toContain("New Jersey");
    expect(prompt).toContain("Hash House Harrier");
  });
});

describe("buildExtractionPrompt", () => {
  it("includes the search text", () => {
    const prompt = buildExtractionPrompt("Found GSH3 in NJ");
    expect(prompt).toContain("Found GSH3 in NJ");
    expect(prompt).toContain("JSON array");
  });
});

describe("parseDiscoveryResponse", () => {
  it("parses valid JSON array", () => {
    const json = JSON.stringify([
      { fullName: "Garden State H3", shortName: "GSH3", website: "https://gsh3.com", location: "NJ" },
      { fullName: "Princeton H3", shortName: "PH3", location: "Princeton, NJ" },
    ]);
    const entries = parseDiscoveryResponse(json);
    expect(entries).toHaveLength(2);
    expect(entries[0].fullName).toBe("Garden State H3");
    expect(entries[0].website).toBe("https://gsh3.com");
    expect(entries[1].website).toBeUndefined();
  });

  it("strips markdown code fences", () => {
    const json = '```json\n[{"fullName":"Test H3","shortName":"TH3"}]\n```';
    const entries = parseDiscoveryResponse(json);
    expect(entries).toHaveLength(1);
  });

  it("skips entries without names", () => {
    const json = JSON.stringify([
      { fullName: "Valid H3", shortName: "VH3" },
      { website: "https://example.com" }, // no name
      { fullName: "", shortName: "" }, // empty names
    ]);
    const entries = parseDiscoveryResponse(json);
    expect(entries).toHaveLength(1);
  });

  it("rejects invalid website URLs", () => {
    const json = JSON.stringify([
      { fullName: "Test H3", shortName: "TH3", website: "not-a-url" },
    ]);
    const entries = parseDiscoveryResponse(json);
    expect(entries[0].website).toBeUndefined();
  });

  it("extracts JSON from natural language prose", () => {
    const text = `Here are the Hash House Harrier kennels I found in New Jersey:\n\n\`\`\`json\n[{"fullName":"Garden State H3","shortName":"GSH3"}]\n\`\`\`\n\nBased on my search, there is one active kennel.`;
    const entries = parseDiscoveryResponse(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].shortName).toBe("GSH3");
  });

  it("extracts JSON array without code fences from prose", () => {
    const text = `I found the following kennels:\n[{"fullName":"Test H3","shortName":"TH3"},{"fullName":"Other H3","shortName":"OH3"}]\nThese are all active.`;
    const entries = parseDiscoveryResponse(text);
    expect(entries).toHaveLength(2);
  });

  it("throws on text with no JSON array at all", () => {
    expect(() => parseDiscoveryResponse("No kennels found in this region.")).toThrow();
  });

  it("returns empty for non-array JSON", () => {
    const entries = parseDiscoveryResponse('{"key":"value"}');
    expect(entries).toEqual([]);
  });

  it("validates foundedYear range", () => {
    const json = JSON.stringify([
      { fullName: "Old H3", shortName: "OH3", foundedYear: 1985 },
      { fullName: "Bad Year", shortName: "BY3", foundedYear: 1800 },
    ]);
    const entries = parseDiscoveryResponse(json);
    expect(entries[0].foundedYear).toBe(1985);
    expect(entries[1].foundedYear).toBeUndefined();
  });
});

describe("discoverKennelsForRegion", () => {
  it("returns error when region not found", async () => {
    regionFindUnique.mockResolvedValue(null);
    const result = await discoverKennelsForRegion("bad-id");
    expect(result.errors).toContain("Region not found");
    expect(result.discovered).toBe(0);
  });

  it("discovers new kennels from Gemini response", async () => {
    setupMocks();
    mockSearchAndExtract.mockResolvedValue({
      text: JSON.stringify([
        { fullName: "Garden State H3", shortName: "GSH3", website: "https://gsh3.com" },
        { fullName: "Princeton H3", shortName: "PH3" },
      ]),
      groundingUrls: [],
      durationMs: 500,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.discovered).toBe(2);
    expect(result.matched).toBe(0);
    expect(discoveryUpsert).toHaveBeenCalledTimes(2);
  });

  it("fuzzy-matches against existing kennels", async () => {
    setupMocks({
      existingKennels: [
        { id: "k1", shortName: "GSH3", fullName: "Garden State H3", aliases: [] },
      ],
    });
    mockSearchAndExtract.mockResolvedValue({
      text: JSON.stringify([
        { fullName: "Garden State Hash House Harriers", shortName: "GSH3" },
        { fullName: "New Kennel H3", shortName: "NKH3" },
      ]),
      groundingUrls: [],
      durationMs: 500,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.matched).toBe(1); // GSH3 matched
    expect(result.discovered).toBe(1); // NKH3 is new
  });

  it("skips already-discovered kennels", async () => {
    setupMocks({
      existingDiscoveries: [{ externalSlug: "gsh3" }],
    });
    mockSearchAndExtract.mockResolvedValue({
      text: JSON.stringify([
        { fullName: "Garden State H3", shortName: "GSH3" },
        { fullName: "New H3", shortName: "NH3" },
      ]),
      groundingUrls: [],
      durationMs: 500,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.skipped).toBe(1);
    expect(result.discovered).toBe(1);
  });

  it("handles Gemini API errors gracefully", async () => {
    setupMocks();
    mockSearchAndExtract.mockResolvedValue({
      text: null,
      groundingUrls: [],
      error: "Rate limit exceeded",
      durationMs: 100,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.discovered).toBe(0);
    expect(result.errors).toContain("AI search error: Rate limit exceeded");
  });

  it("handles malformed Gemini response", async () => {
    setupMocks();
    mockSearchAndExtract.mockResolvedValue({
      text: "This is not JSON at all, just random text about hash kennels",
      groundingUrls: [],
      durationMs: 500,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.discovered).toBe(0);
    expect(result.errors).toContain("Failed to parse AI discovery response as JSON");
  });

  it("handles empty Gemini response", async () => {
    setupMocks();
    mockSearchAndExtract.mockResolvedValue({
      text: "[]",
      groundingUrls: [],
      durationMs: 500,
    });

    const result = await discoverKennelsForRegion("r1");
    expect(result.discovered).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("handles DB upsert errors per-entry", async () => {
    setupMocks();
    mockSearchAndExtract.mockResolvedValue({
      text: JSON.stringify([
        { fullName: "Good H3", shortName: "GH3" },
        { fullName: "Bad H3", shortName: "BH3" },
      ]),
      groundingUrls: [],
      durationMs: 500,
    });

    discoveryUpsert
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("DB error"));

    const result = await discoverKennelsForRegion("r1");
    expect(result.discovered).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to save discovery");
  });
});

describe("extractJsonArray — robustness", () => {
  it("handles nested arrays in JSON", () => {
    const json = '[{"name":"H3","aliases":["A","B"]},{"name":"H4","aliases":[]}]';
    const result = extractJsonArray(json) as unknown[];
    expect(result).toHaveLength(2);
  });

  it("extracts JSON with nested brackets from prose", () => {
    const text = 'Here are results:\n[{"name":"H3","aliases":["A","B"]},{"name":"H4"}]\nEnd.';
    const result = extractJsonArray(text) as unknown[];
    expect(result).toHaveLength(2);
  });

  it("handles prose with no valid JSON array", () => {
    expect(() => extractJsonArray("No kennels were found.")).toThrow("No JSON array found");
  });
});
