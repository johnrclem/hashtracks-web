import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseTrailBlock, parseTimeMention, NorthboroHashAdapter } from "./northboro-hash";

// Mock browserRender
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-abc123"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

const SOURCE_URL = "https://www.northboroh3.com/calendar";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-northboro",
    name: "Northboro H3 Website",
    url: "https://www.northboroh3.com",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "weekly",
    scrapeDays: 90,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

describe("parseTimeMention", () => {
  it("parses standard 12-hour time", () => {
    expect(parseTimeMention("start time 12:30 pm")).toBe("12:30");
  });

  it("parses bare hour with am/pm", () => {
    expect(parseTimeMention("12pm")).toBe("12:00");
    expect(parseTimeMention("11am")).toBe("11:00");
    expect(parseTimeMention("1pm")).toBe("13:00");
  });

  it("parses range like 11-12ish", () => {
    expect(parseTimeMention("11-12ish")).toBe("12:00");
    expect(parseTimeMention("10-11ish")).toBe("11:00");
  });

  it("returns undefined for no time mention", () => {
    expect(parseTimeMention("Worcester")).toBeUndefined();
  });
});

describe("parseTrailBlock", () => {
  it("parses basic trail with run number and date", () => {
    const result = parseTrailBlock(
      ["February Trail #237, 2/15/26"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-02-15",
      kennelTag: "NbH3",
      runNumber: 237,
      title: "NbH3 Trail #237",
      hares: undefined,
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with title and hares on first line", () => {
    const result = parseTrailBlock(
      ["January Trail #236, 1/1/26, Hangover Trail, Scrumples"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-01-01",
      kennelTag: "NbH3",
      runNumber: 236,
      title: "Hangover Trail",
      hares: "Scrumples",
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with hares on separate line", () => {
    const result = parseTrailBlock(
      ["March Trail #238, 3/14/26, Pi Day Hash", "Hares: Alice, Bob"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-03-14",
      kennelTag: "NbH3",
      runNumber: 238,
      title: "Pi Day Hash",
      hares: "Alice, Bob",
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses trail with location and time", () => {
    const result = parseTrailBlock(
      [
        "April Trail #239, 4/18/26",
        "Hares: HashName",
        "Worcester, start time 11-12ish",
      ],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-04-18",
      kennelTag: "NbH3",
      runNumber: 239,
      title: "NbH3 Trail #239",
      hares: "HashName",
      location: "Worcester",
      startTime: "12:00",
      sourceUrl: SOURCE_URL,
    });
  });

  it("parses full date with 4-digit year", () => {
    const result = parseTrailBlock(
      ["May Trail #240, 5/16/2026"],
      SOURCE_URL,
    );
    expect(result).toEqual({
      date: "2026-05-16",
      kennelTag: "NbH3",
      runNumber: 240,
      title: "NbH3 Trail #240",
      hares: undefined,
      location: undefined,
      startTime: undefined,
      sourceUrl: SOURCE_URL,
    });
  });

  it("returns null for non-trail text", () => {
    expect(parseTrailBlock(["Some random text"], SOURCE_URL)).toBeNull();
    expect(parseTrailBlock(["ANCIENT HASHTORY"], SOURCE_URL)).toBeNull();
    expect(parseTrailBlock([], SOURCE_URL)).toBeNull();
  });

  it("handles location on its own line", () => {
    const result = parseTrailBlock(
      ["June Trail #241, 6/20/26", "Framingham"],
      SOURCE_URL,
    );
    expect(result?.location).toBe("Framingham");
  });
});

describe("NorthboroHashAdapter", () => {
  const adapter = new NorthboroHashAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses upcoming trails from rendered HTML", async () => {
    const html = `
      <html><body>
        <div data-testid="richTextElement">
          <h2>Upcumming Trails</h2>
          <p>February Trail #237, 2/15/26, Winter Hash</p>
          <p>Hares: Frosty, Snowball</p>
          <p>March Trail #238, 3/14/26, Pi Day Hash</p>
          <p>Hares: MathNerd</p>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      date: "2026-02-15",
      kennelTag: "NbH3",
      runNumber: 237,
      title: "Winter Hash",
    });
    expect(result.events[1]).toMatchObject({
      date: "2026-03-14",
      kennelTag: "NbH3",
      runNumber: 238,
      title: "Pi Day Hash",
    });
  });

  it("parses historical trails from ANCIENT HASHTORY section", async () => {
    const html = `
      <html><body>
        <div>
          <h2>Upcumming Trails</h2>
          <p>March Trail #238, 3/14/26</p>
        </div>
        <div>
          <h2>ANCIENT HASHTORY</h2>
          <h3>2025</h3>
          <p>December Trail #235, 12/20/25, Holiday Hash, Santa</p>
          <p>November Trail #234, 11/15/25</p>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    const december = result.events.find((e) => e.runNumber === 235);
    expect(december).toMatchObject({
      date: "2025-12-20",
      kennelTag: "NbH3",
      runNumber: 235,
      title: "Holiday Hash",
      hares: "Santa",
    });
  });

  it("handles missing hares and location gracefully", async () => {
    const html = `
      <html><body>
        <p>April Trail #239, 4/18/26</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBeUndefined();
    expect(result.events[0].location).toBeUndefined();
  });

  it("returns fetch error when browserRender fails", async () => {
    mockedBrowserRender.mockRejectedValue(
      new Error("Browser render error (502): Navigation timeout"),
    );

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Browser render failed");
  });

  it("extracts start time from time mentions", async () => {
    const html = `
      <html><body>
        <p>May Trail #240, 5/16/26</p>
        <p>Worcester, start time 11-12ish</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].startTime).toBe("12:00");
    expect(result.events[0].location).toBe("Worcester");
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `
      <html><body>
        <p>June Trail #241, 6/20/26</p>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-abc123");
    expect(result.diagnosticContext).toHaveProperty("textBlocksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed", 1);
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });
});
