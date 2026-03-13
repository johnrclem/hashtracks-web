import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseCalendarLink, BurlingtonHashAdapter } from "./burlington-hash";

// Mock browserRender
vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-burly123"),
}));

const { browserRender } = await import("@/lib/browser-render");
const mockedBrowserRender = vi.mocked(browserRender);

const SOURCE_URL = "https://www.burlingtonh3.com/hareline";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-burlington",
    name: "Burlington H3 Website Hareline",
    url: "https://www.burlingtonh3.com/hareline",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
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

describe("parseCalendarLink", () => {
  it("parses standard event with title, run number, time, and location", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23846%3A+Season+Premier" +
      "&dates=20260401T223000Z/20260401T233000Z" +
      "&details=Hares%3A+Trailblazer+%26+MapQuest" +
      "&location=City+Hall+Park%2C+Burlington+VT";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      date: "2026-04-01",
      kennelTag: "BurlyH3",
      runNumber: 846,
      title: "Season Premier",
      hares: "Trailblazer & MapQuest",
      location: "City Hall Park, Burlington VT",
      sourceUrl: SOURCE_URL,
    });
    expect(result?.startTime).toBeDefined();
  });

  it("parses event with missing location", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23847%3A+Mud+Season+Hash" +
      "&dates=20260415T223000Z/20260415T233000Z" +
      "&details=Hares%3A+Muddy+Buddy";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      kennelTag: "BurlyH3",
      runNumber: 847,
      title: "Mud Season Hash",
      hares: "Muddy Buddy",
    });
    expect(result?.location).toBeUndefined();
  });

  it("parses special event without run number", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=Annual+Invihash+2026" +
      "&dates=20260704T160000Z/20260704T200000Z" +
      "&details=Come+join+us!" +
      "&location=Waterfront+Park";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      kennelTag: "BurlyH3",
      title: "Annual Invihash 2026",
      location: "Waterfront Park",
    });
    expect(result?.runNumber).toBeUndefined();
    expect(result?.hares).toBeUndefined();
  });

  it("handles URL-encoded special characters in details", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23848%3A+Pi+Day+Hash" +
      "&dates=20260314T223000Z/20260314T233000Z" +
      "&details=Hares%3A+%C3%89clair+%26+Cr%C3%A8me+Br%C3%BBl%C3%A9e%0ACost%3A+%246.90" +
      "&location=Church+Street";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result).toMatchObject({
      runNumber: 848,
      title: "Pi Day Hash",
      hares: "Éclair & Crème Brûlée",
      location: "Church Street",
    });
  });

  it("returns null for non-calendar URLs", () => {
    expect(parseCalendarLink("https://example.com", SOURCE_URL)).toBeNull();
  });

  it("returns null for missing text param", () => {
    const href = "https://calendar.google.com/calendar/render?dates=20260401T220000Z/20260401T230000Z";
    expect(parseCalendarLink(href, SOURCE_URL)).toBeNull();
  });

  it("returns null for missing dates param", () => {
    const href = "https://calendar.google.com/calendar/render?text=Test+Event";
    expect(parseCalendarLink(href, SOURCE_URL)).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(parseCalendarLink("not a url", SOURCE_URL)).toBeNull();
  });

  it("strips 'Location:' from hares field", () => {
    const href =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23849%3A+Spring+Hash" +
      "&dates=20260501T223000Z/20260501T233000Z" +
      "&details=Hares%3A+Penis+ColadaLocation%3A+Probably+Bolton";

    const result = parseCalendarLink(href, SOURCE_URL);

    expect(result?.hares).toBe("Penis Colada");
  });
});

describe("BurlingtonHashAdapter", () => {
  const adapter = new BurlingtonHashAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses events from Google Calendar links in rendered HTML", async () => {
    const html = `
      <html><body>
        <div>
          <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23846%3A+Season+Premier&dates=20260401T223000Z/20260401T233000Z&details=Hares%3A+Trailblazer&location=City+Hall+Park">
            Add to Calendar
          </a>
          <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23847%3A+Mud+Run&dates=20260415T223000Z/20260415T233000Z&details=Hares%3A+Muddy&location=Waterfront">
            Add to Calendar
          </a>
        </div>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      kennelTag: "BurlyH3",
      runNumber: 846,
      title: "Season Premier",
    });
    expect(result.events[1]).toMatchObject({
      kennelTag: "BurlyH3",
      runNumber: 847,
      title: "Mud Run",
    });
  });

  it("deduplicates events by run number", async () => {
    const link =
      "https://calendar.google.com/calendar/render?action=TEMPLATE" +
      "&text=BTVH3+%23846%3A+Season+Premier" +
      "&dates=20260401T223000Z/20260401T233000Z&details=test";
    const html = `
      <html><body>
        <a href="${link}">Add to Calendar</a>
        <a href="${link}">Add to Calendar (duplicate)</a>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
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

  it("handles page with no calendar links", async () => {
    const html = `<html><body><p>Coming soon!</p></body></html>`;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `
      <html><body>
        <a href="https://calendar.google.com/calendar/render?action=TEMPLATE&text=BTVH3+%23846%3A+Test&dates=20260401T223000Z/20260401T233000Z&details=test">
          Add to Calendar
        </a>
      </body></html>
    `;
    mockedBrowserRender.mockResolvedValue(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-burly123");
    expect(result.diagnosticContext).toHaveProperty("calendarLinksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed", 1);
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });
});
