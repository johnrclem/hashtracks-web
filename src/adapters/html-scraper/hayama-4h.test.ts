import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseSectionText, Hayama4HAdapter } from "./hayama-4h";

// Mock browser-render (used by fetchBrowserRenderedPage)
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-hayama4h"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-hayama4h",
    name: "Hayama 4H Website",
    url: "https://sites.google.com/site/hayama4h/hashes",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
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

const SOURCE_URL = "https://sites.google.com/site/hayama4h/hashes";

// --- Unit Tests ---

describe("parseSectionText", () => {
  it("parses a standard section with all fields", () => {
    const text =
      "No:204 Date:2026-03-29 Place: Mejiroyamashita(目白山下) Hare: Super Spreader";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-29");
    expect(event!.kennelTags[0]).toBe("hayama-4h");
    expect(event!.runNumber).toBe(204);
    expect(event!.location).toBe("Mejiroyamashita(目白山下)");
    expect(event!.hares).toBe("Super Spreader");
    expect(event!.title).toBe("Hayama 4H #204");
  });

  it("parses section with Photo link after hare", () => {
    const text =
      "No:200 Date:2025-11-23 Place: Kamakura Hare: Hash Ninja Photo: link";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(200);
    expect(event!.hares).toBe("Hash Ninja");
    expect(event!.location).toBe("Kamakura");
  });

  it("parses section with Report after hare", () => {
    const text =
      "No:195 Date:2025-06-15 Place: Zushi Beach Hare: Beer Hunter Report: link";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Beer Hunter");
  });

  it("parses section with Foods after hare", () => {
    const text =
      "No:190 Date:2025-01-12 Place: Hayama Park Hare: Trail Blazer Foods: link";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Trail Blazer");
  });

  it("handles section with no hare", () => {
    const text = "No:180 Date:2024-05-05 Place: Yokosuka";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2024-05-05");
    expect(event!.location).toBe("Yokosuka");
    expect(event!.hares).toBeUndefined();
  });

  it("handles section with no place", () => {
    const text = "No:175 Date:2024-02-10 Hare: Someone";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
    expect(event!.hares).toBe("Someone");
  });

  it("returns null for text with no date", () => {
    const event = parseSectionText("No:100 Place: Somewhere", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("returns null for empty text", () => {
    const event = parseSectionText("", SOURCE_URL);
    expect(event).toBeNull();
  });

  it("returns null for invalid date", () => {
    const event = parseSectionText(
      "No:100 Date:2025-13-45 Place: Nowhere",
      SOURCE_URL,
    );
    expect(event).toBeNull();
  });

  it("handles whitespace variations", () => {
    const text =
      "  No:201  Date:2025-12-20   Place:  Kamakura Station   Hare:  Trail Boss  ";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(201);
    expect(event!.location).toBe("Kamakura Station");
    expect(event!.hares).toBe("Trail Boss");
  });

  it("generates title without run number", () => {
    const text = "Date:2025-08-01 Place: Beach Hare: Someone";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.title).toBe("Hayama 4H Run");
    expect(event!.runNumber).toBeUndefined();
  });

  it("handles Japanese characters in place names", () => {
    const text =
      "No:203 Date:2026-02-22 Place: 逗子海岸(Zushi Beach) Hare: Wave Runner";
    const event = parseSectionText(text, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.location).toBe("逗子海岸(Zushi Beach)");
  });
});

// --- Integration test ---

describe("Hayama4HAdapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a page with multiple sections", async () => {
    const html = `<html><body>
      <section>No:204 Date:2026-03-29 Place: Mejiroyamashita(目白山下) Hare: Super Spreader</section>
      <section>No:203 Date:2026-02-22 Place: Zushi Beach Hare: Wave Runner</section>
      <section>No:202 Date:2026-01-18 Place: Kamakura Hare: Hash Ninja Photo: link</section>
    </body></html>`;

    mockedBrowserRender.mockResolvedValue(html);

    const adapter = new Hayama4HAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBe("mock-hash-hayama4h");
    expect(result.events[0].date).toBe("2026-03-29");
    expect(result.events[0].runNumber).toBe(204);
    expect(result.events[1].location).toBe("Zushi Beach");
    expect(result.events[2].hares).toBe("Hash Ninja");
  });

  it("skips sections without dates", async () => {
    const html = `<html><body>
      <section>Welcome to Hayama 4H!</section>
      <section>No:204 Date:2026-03-29 Place: Test Hare: Someone</section>
      <section>Some other content</section>
    </body></html>`;

    mockedBrowserRender.mockResolvedValue(html);

    const adapter = new Hayama4HAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(204);
  });

  it("handles browser render error gracefully", async () => {
    mockedBrowserRender.mockRejectedValue(new Error("Browser render unavailable"));

    const adapter = new Hayama4HAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Browser render failed");
  });

  it("passes waitFor option to browser render", async () => {
    const html = `<html><body><section>No:1 Date:2025-01-01 Place: Test</section></body></html>`;
    mockedBrowserRender.mockResolvedValue(html);

    const adapter = new Hayama4HAdapter();
    await adapter.fetch(makeSource());

    expect(mockedBrowserRender).toHaveBeenCalledWith({
      url: "https://sites.google.com/site/hayama4h/hashes",
      waitFor: "section",
    });
  });

  it("returns diagnostic context", async () => {
    const html = `<html><body>
      <section>No:204 Date:2026-03-29 Place: Test Hare: Foo</section>
      <section>No date here</section>
    </body></html>`;

    mockedBrowserRender.mockResolvedValue(html);

    const adapter = new Hayama4HAdapter();
    const result = await adapter.fetch(makeSource());

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.sectionsFound).toBe(2);
    expect(result.diagnosticContext!.eventsParsed).toBe(1);
  });
});
