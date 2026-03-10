import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseDtDdBlock, RIH3Adapter } from "./rih3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-rih3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://rih3.com/hareline.html";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-rih3",
    name: "RIH3 Website Hareline",
    url: "https://rih3.com/hareline.html",
    type: "HTML_SCRAPER",
    trustLevel: 6,
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

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers(),
  } as Response);
}

describe("parseDtDdBlock", () => {
  it("parses standard event with date, run number, hare, and directions", () => {
    const fields = new Map([
      ["date", "Mon. March 9"],
      ["run", "2089"],
      ["hare", "WIPOS"],
      ["directions", "St. Andrews Farm, Barrington https://www.google.com/maps/place/123"],
    ]);

    const result = parseDtDdBlock(fields, SOURCE_URL);

    expect(result).toMatchObject({
      date: "2026-03-09",
      kennelTag: "RIH3",
      runNumber: 2089,
      title: "RIH3 #2089",
      hares: "WIPOS",
      startTime: "18:30",
      sourceUrl: SOURCE_URL,
    });
    expect(result?.location).toContain("St. Andrews Farm");
    expect(result?.locationUrl).toContain("google.com/maps");
  });

  it("parses event with missing hare (NEED A HARE)", () => {
    const fields = new Map([
      ["date", "Mon. March 16"],
      ["run", "2090"],
      ["hare", "NEED A HARE"],
    ]);

    const result = parseDtDdBlock(fields, SOURCE_URL);

    expect(result).toMatchObject({
      date: "2026-03-16",
      runNumber: 2090,
      title: "RIH3 #2090",
    });
    expect(result?.hares).toBeUndefined();
  });

  it("parses event with TBD hare", () => {
    const fields = new Map([
      ["date", "Mon. March 23"],
      ["run", "2091"],
      ["hare", "TBD"],
    ]);

    const result = parseDtDdBlock(fields, SOURCE_URL);
    expect(result?.hares).toBeUndefined();
  });

  it("returns null for block without date", () => {
    const fields = new Map([
      ["run", "2089"],
      ["hare", "WIPOS"],
    ]);
    expect(parseDtDdBlock(fields, SOURCE_URL)).toBeNull();
  });

  it("returns null for empty fields", () => {
    expect(parseDtDdBlock(new Map(), SOURCE_URL)).toBeNull();
  });

  it("handles event without run number", () => {
    const fields = new Map([
      ["date", "Mon. April 6"],
      ["hare", "SomeHasher"],
    ]);

    const result = parseDtDdBlock(fields, SOURCE_URL);

    expect(result).toMatchObject({
      kennelTag: "RIH3",
      title: "RIH3 Monday Trail",
      hares: "SomeHasher",
    });
    expect(result?.runNumber).toBeUndefined();
  });

  it("extracts location without URL", () => {
    const fields = new Map([
      ["date", "Mon. March 9"],
      ["run", "2089"],
      ["directions", "Downtown Providence, near the State House"],
    ]);

    const result = parseDtDdBlock(fields, SOURCE_URL);
    expect(result?.location).toBe("Downtown Providence, near the State House");
    expect(result?.locationUrl).toBeUndefined();
  });
});

describe("RIH3Adapter", () => {
  const adapter = new RIH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses multiple events separated by <hr>", async () => {
    const html = `
      <html><body>
        <dl>
          <dt>Date:</dt><dd>Mon. March 9</dd>
          <dt>Run</dt><dd>2089</dd>
          <dt>Hare:</dt><dd><strong>WIPOS</strong></dd>
          <dt>Directions:</dt><dd>St. Andrews Farm, Barrington</dd>
        </dl>
        <hr>
        <dl>
          <dt>Date:</dt><dd>Mon. March 16</dd>
          <dt>Run</dt><dd>2090</dd>
          <dt>Hare:</dt><dd><strong>Just Pat</strong></dd>
          <dt>Directions:</dt><dd>TBD</dd>
        </dl>
      </body></html>
    `;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      runNumber: 2089,
      hares: "WIPOS",
    });
    expect(result.events[1]).toMatchObject({
      runNumber: 2090,
      hares: "Just Pat",
    });
  });

  it("handles page with no events", async () => {
    const html = `<html><body><p>No upcoming runs</p></body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns fetch error on HTTP failure", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `
      <html><body>
        <dt>Date:</dt><dd>Mon. March 9</dd>
        <dt>Run</dt><dd>2089</dd>
        <dt>Hare:</dt><dd>TestHare</dd>
      </body></html>
    `;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-rih3");
    expect(result.diagnosticContext).toHaveProperty("blocksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed");
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });

  it("skips NEED A HARE placeholders", async () => {
    const html = `
      <html><body>
        <dt>Date:</dt><dd>Mon. March 23</dd>
        <dt>Run</dt><dd>2091</dd>
        <dt>Hare:</dt><dd>NEED A HARE</dd>
      </body></html>
    `;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBeUndefined();
    expect(result.events[0].runNumber).toBe(2091);
  });
});
