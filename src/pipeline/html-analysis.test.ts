import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import { buildAnalysisPrompt, parseGeminiResponse, analyzeUrlForProposal, refineAnalysis } from "./html-analysis";

// Mock dependencies
vi.mock("@/adapters/utils", () => ({
  fetchHTMLPage: vi.fn(),
  validateSourceUrl: vi.fn(),
}));

vi.mock("@/lib/ai/gemini", () => ({
  callGemini: vi.fn(),
}));

vi.mock("@/app/admin/sources/html-analysis-utils", () => ({
  findCandidateContainers: vi.fn(),
}));

vi.mock("@/adapters/html-scraper/examples", () => ({
  getExamplesForLayout: vi.fn().mockReturnValue([]),
  formatExamplesForPrompt: vi.fn().mockReturnValue(""),
}));

import { fetchHTMLPage, validateSourceUrl } from "@/adapters/utils";
import { callGemini } from "@/lib/ai/gemini";
import { findCandidateContainers } from "@/app/admin/sources/html-analysis-utils";

const mockFetchHTMLPage = vi.mocked(fetchHTMLPage);
const mockValidateSourceUrl = vi.mocked(validateSourceUrl);
const mockCallGemini = vi.mocked(callGemini);
const mockFindContainers = vi.mocked(findCandidateContainers);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAnalysisPrompt", () => {
  it("includes candidate data in prompt", () => {
    const candidate = {
      containerSelector: "table.events",
      rowSelector: "tbody tr",
      rowCount: 10,
      sampleRows: [["Jan 1", "Trail Name", "Hare"]],
      layoutType: "table" as const,
    };

    const prompt = buildAnalysisPrompt(candidate, "table");
    expect(prompt).toContain("table.events");
    expect(prompt).toContain("tbody tr");
    expect(prompt).toContain("10 total rows found");
    expect(prompt).toContain("Jan 1");
  });
});

describe("parseGeminiResponse", () => {
  it("parses valid JSON response", () => {
    const response = JSON.stringify({
      columns: { date: "td:nth-child(1)", hares: "td:nth-child(2)" },
      defaultKennelTag: "NYCH3",
      dateLocale: "en-US",
      confidence: "high",
      explanation: "Table layout with dates in column 1",
    });

    const result = parseGeminiResponse(response);
    expect(result).not.toBeNull();
    expect(result!.columns.date).toBe("td:nth-child(1)");
    expect(result!.columns.hares).toBe("td:nth-child(2)");
    expect(result!.defaultKennelTag).toBe("NYCH3");
    expect(result!.confidence).toBe("high");
  });

  it("strips markdown code fences", () => {
    const response = '```json\n{"columns":{"date":"td:nth-child(1)"},"defaultKennelTag":"X","dateLocale":"en-US","confidence":"medium","explanation":"ok"}\n```';
    const result = parseGeminiResponse(response);
    expect(result).not.toBeNull();
    expect(result!.columns.date).toBe("td:nth-child(1)");
  });

  it("returns null when date selector is missing", () => {
    const response = JSON.stringify({
      columns: { hares: "td:nth-child(2)" },
      defaultKennelTag: "X",
      dateLocale: "en-US",
      confidence: "low",
      explanation: "no date",
    });
    expect(parseGeminiResponse(response)).toBeNull();
  });

  it("returns null for unparseable text", () => {
    expect(parseGeminiResponse("not json at all")).toBeNull();
  });

  it("sanitizes dangerous selectors", () => {
    const response = JSON.stringify({
      columns: { date: "td:nth-child(1)", hares: '<script>alert("xss")</script>' },
      defaultKennelTag: "X",
      dateLocale: "en-US",
      confidence: "high",
      explanation: "ok",
    });
    const result = parseGeminiResponse(response);
    expect(result).not.toBeNull();
    expect(result!.columns.hares).toBeUndefined();
  });
});

describe("analyzeUrlForProposal", () => {
  it("returns error for empty URL", async () => {
    const result = await analyzeUrlForProposal("");
    expect(result.error).toBe("URL required");
  });

  it("returns error for invalid URL", async () => {
    mockValidateSourceUrl.mockImplementation(() => {
      throw new Error("SSRF blocked");
    });

    const result = await analyzeUrlForProposal("http://localhost/evil");
    expect(result.error).toBe("SSRF blocked");
  });

  it("returns error when fetch fails", async () => {
    mockValidateSourceUrl.mockImplementation(() => {});
    mockFetchHTMLPage.mockResolvedValue({
      ok: false,
      result: { events: [], errors: ["Connection refused"] },
    } as never);

    const result = await analyzeUrlForProposal("https://example.com");
    expect(result.error).toBe("Connection refused");
  });

  it("returns null config when no containers found", async () => {
    mockValidateSourceUrl.mockImplementation(() => {});
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      $: cheerio.load(""),
      result: { events: [], errors: [] },
    } as never);
    mockFindContainers.mockReturnValue([]);

    const result = await analyzeUrlForProposal("https://example.com");
    expect(result.suggestedConfig).toBeNull();
    expect(result.explanation).toContain("No event-like containers");
  });

  it("returns config when Gemini succeeds", async () => {
    mockValidateSourceUrl.mockImplementation(() => {});
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      $: cheerio.load(""),
      result: { events: [], errors: [] },
    } as never);
    mockFindContainers.mockReturnValue([{
      containerSelector: "table.events",
      rowSelector: "tbody tr",
      rowCount: 10,
      sampleRows: [["Jan 1", "Trail"]],
      layoutType: "table",
    }]);
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        columns: { date: "td:nth-child(1)", title: "td:nth-child(2)" },
        defaultKennelTag: "XH3",
        dateLocale: "en-US",
        confidence: "high",
        explanation: "dates in column 1",
      }),
      durationMs: 100,
    });

    const result = await analyzeUrlForProposal("https://example.com/events");
    expect(result.suggestedConfig).not.toBeNull();
    expect(result.suggestedConfig!.containerSelector).toBe("table.events");
    expect(result.suggestedConfig!.columns.date).toBe("td:nth-child(1)");
    expect(result.confidence).toBe("high");
  });
});

describe("refineAnalysis", () => {
  it("returns error for empty URL", async () => {
    const result = await refineAnalysis("", {}, "fix it");
    expect(result.error).toBe("URL required");
  });

  it("refines config with feedback", async () => {
    mockValidateSourceUrl.mockImplementation(() => {});
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      $: cheerio.load(""),
      result: { events: [], errors: [] },
    } as never);
    mockFindContainers.mockReturnValue([{
      containerSelector: "table.events",
      rowSelector: "tbody tr",
      rowCount: 10,
      sampleRows: [["Jan 1", "Trail", "Location"]],
      layoutType: "table",
    }]);
    mockCallGemini.mockResolvedValue({
      text: JSON.stringify({
        columns: { date: "td:nth-child(1)", location: "td:nth-child(3)" },
        defaultKennelTag: "XH3",
        dateLocale: "en-US",
        confidence: "high",
        explanation: "moved location to column 3 per feedback",
      }),
      durationMs: 80,
    });

    const result = await refineAnalysis(
      "https://example.com/events",
      { columns: { date: "td:nth-child(1)", location: "td:nth-child(2)" } as never },
      "location is in column 3",
    );
    expect(result.suggestedConfig).not.toBeNull();
    expect(result.suggestedConfig!.columns.location).toBe("td:nth-child(3)");
    expect(result.explanation).toContain("column 3");
  });
});
