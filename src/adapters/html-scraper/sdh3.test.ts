import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseHarelineDate,
  extractHistoryEntry,
  parseHarelineEvents,
  parseHistoryEvents,
  SDH3Adapter,
} from "./sdh3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-sdh3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-sdh3",
    name: "SDH3 Website",
    url: "https://sdh3.com/hareline.shtml",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    scrapeDays: 365,
    config: {
      kennelCodeMap: { SDH3: "SDH3", IRH3: "IRH3", OCSD: "OCSD" },
      kennelNameMap: {
        "San Diego": "SDH3",
        "Iron Rule": "IRH3",
        "Orange Curtain": "OCSD",
      },
      includeHistory: false,
    },
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

// ── Inline HTML fixtures ──

const HARELINE_HTML = `<html><body>
<dl>
  <dt class="hashEvent SDH3">
    <strong>San Diego H3</strong>
    <span style="white-space:nowrap">Friday, March 20, 2026 6:00pm</span>
    <div>
      <strong>Hare(s):</strong> Trail Blazer &amp; Lost Cause<br>
      <strong>Address:</strong> 123 Main St, San Diego, CA<br>
      <strong>Map Link:</strong> <a href="https://maps.app.goo.gl/abc123">Map</a><br>
      <strong>Run Fee:</strong> $7<br>
      <strong>Trail type:</strong> A to A<br>
      <strong>Dog friendly:</strong> Yes<br>
      <strong>Notes:</strong> Bring a headlamp
    </div>
  </dt>
  <dt class="hashEvent IRH3">
    <strong>Iron Rule H3</strong>
    <span style="white-space:nowrap">Saturday, March 21, 2026 3:00pm</span>
    <div>
      <strong>Hare(s):</strong> Iron Mike
    </div>
  </dt>
  <dt class="hashEvent UNKN">
    <strong>Unknown Kennel</strong>
    <span style="white-space:nowrap">Sunday, March 22, 2026 4:00pm</span>
    <div></div>
  </dt>
</dl>
</body></html>`;

const HISTORY_HTML = `<html><body>
<ol>
  <li>Sunday, December 3, 2006 6:30pm: <a href="/e/event-20061203183000.shtml">The Cold Moon (San Diego)</a></li>
  <li>Friday, January 5, 2007 7:00pm: <a href="/e/event-20070105190000.shtml">New Year Hash (Iron Rule)</a></li>
  <li>Saturday, February 10, 2007 4:00pm: <a href="/e/event-20070210160000.shtml">Valentine Bash</a></li>
  <li>Monday, March 12, 2007 6:00pm: <a href="/e/event-20070312180000.shtml">St Patty's Warm-up (Unknown Kennel)</a></li>
</ol>
</body></html>`;

// ── parseHarelineDate ──

describe("parseHarelineDate", () => {
  it("parses full date with time", () => {
    const result = parseHarelineDate("Friday, March 20, 2026 6:00pm");
    expect(result).toEqual({ date: "2026-03-20", startTime: "18:00" });
  });

  it("parses date without time", () => {
    const result = parseHarelineDate("Saturday, March 21, 2026");
    expect(result).toEqual({ date: "2026-03-21", startTime: undefined });
  });

  it("returns null for empty string", () => {
    expect(parseHarelineDate("")).toBeNull();
  });

  it("returns null for unparseable text", () => {
    expect(parseHarelineDate("not a date")).toBeNull();
  });

  it("parses date with AM time", () => {
    const result = parseHarelineDate("Sunday, April 5, 2026 10:30am");
    expect(result).toEqual({ date: "2026-04-05", startTime: "10:30" });
  });

  it("handles 12:00pm correctly", () => {
    const result = parseHarelineDate("Monday, June 1, 2026 12:00pm");
    expect(result).toEqual({ date: "2026-06-01", startTime: "12:00" });
  });
});

// ── extractHistoryEntry ──

describe("extractHistoryEntry", () => {
  it("extracts entry with kennel in parentheses", () => {
    const result = extractHistoryEntry(
      "Sunday, December 3, 2006 6:30pm:",
      "The Cold Moon (San Diego)",
      "/e/event-20061203183000.shtml",
    );
    expect(result).toEqual({
      date: "2006-12-03",
      startTime: "18:30",
      title: "The Cold Moon",
      kennelName: "San Diego",
      sourceUrl: "https://sdh3.com/e/event-20061203183000.shtml",
    });
  });

  it("extracts entry without parenthetical (no kennel)", () => {
    const result = extractHistoryEntry(
      "Saturday, February 10, 2007 4:00pm:",
      "Valentine Bash",
      "/e/event-20070210160000.shtml",
    );
    expect(result).toEqual({
      date: "2007-02-10",
      startTime: "16:00",
      title: "Valentine Bash",
      kennelName: undefined,
      sourceUrl: "https://sdh3.com/e/event-20070210160000.shtml",
    });
  });

  it("handles nested parentheses — extracts LAST parenthetical as kennel", () => {
    const result = extractHistoryEntry(
      "Friday, May 5, 2006 6:00pm:",
      "Cinco de Mayo (Part 2) (Iron Rule)",
      "/e/event-20060505180000.shtml",
    );
    expect(result).toEqual({
      date: "2006-05-05",
      startTime: "18:00",
      title: "Cinco de Mayo (Part 2)",
      kennelName: "Iron Rule",
      sourceUrl: "https://sdh3.com/e/event-20060505180000.shtml",
    });
  });

  it("returns null for empty text", () => {
    expect(extractHistoryEntry("", "Some Title", "/e/foo.shtml")).toBeNull();
  });

  it("returns null for unparseable date text", () => {
    expect(
      extractHistoryEntry("not a date", "Title (Kennel)", "/e/foo.shtml"),
    ).toBeNull();
  });

  it("constructs sourceUrl from href without leading slash", () => {
    const result = extractHistoryEntry(
      "Friday, March 1, 2008 6:00pm:",
      "Test (San Diego)",
      "e/event-20080301.shtml",
    );
    expect(result?.sourceUrl).toBe("https://sdh3.com/e/event-20080301.shtml");
  });
});

// ── parseHarelineEvents ──

describe("parseHarelineEvents", () => {
  const config = {
    kennelCodeMap: { SDH3: "SDH3", IRH3: "IRH3" },
    kennelNameMap: { "San Diego": "SDH3", "Iron Rule": "IRH3" },
  };

  it("parses a dt with all fields", () => {
    const events = parseHarelineEvents(HARELINE_HTML, config);
    const sdh3Event = events.find((e) => e.kennelTag === "SDH3");

    expect(sdh3Event).toBeDefined();
    expect(sdh3Event).toMatchObject({
      date: "2026-03-20",
      kennelTag: "SDH3",
      startTime: "18:00",
      hares: "Trail Blazer & Lost Cause",
      location: "123 Main St, San Diego, CA",
      locationUrl: "https://maps.app.goo.gl/abc123",
    });
    expect(sdh3Event?.description).toContain("Hash Cash: $7");
    expect(sdh3Event?.description).toContain("Trail: A to A");
    expect(sdh3Event?.description).toContain("Dog Friendly: Yes");
    expect(sdh3Event?.description).toContain("Bring a headlamp");
  });

  it("parses a dt with minimal fields", () => {
    const events = parseHarelineEvents(HARELINE_HTML, config);
    const irh3Event = events.find((e) => e.kennelTag === "IRH3");

    expect(irh3Event).toBeDefined();
    expect(irh3Event).toMatchObject({
      date: "2026-03-21",
      kennelTag: "IRH3",
      startTime: "15:00",
      hares: "Iron Mike",
    });
    expect(irh3Event?.location).toBeUndefined();
    expect(irh3Event?.locationUrl).toBeUndefined();
  });

  it("extracts kennel code from CSS class", () => {
    const events = parseHarelineEvents(HARELINE_HTML, config);
    const tags = events.map((e) => e.kennelTag);
    expect(tags).toContain("SDH3");
    expect(tags).toContain("IRH3");
  });

  it("skips unknown kennel codes not in kennelCodeMap", () => {
    const events = parseHarelineEvents(HARELINE_HTML, config);
    // "UNKN" is not in the config, so it should be skipped
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.kennelTag !== "UNKN")).toBe(true);
  });
});

// ── parseHistoryEvents ──

describe("parseHistoryEvents", () => {
  const config = {
    kennelCodeMap: { SDH3: "SDH3", IRH3: "IRH3" },
    kennelNameMap: { "San Diego": "SDH3", "Iron Rule": "IRH3" },
  };

  it("parses an li entry with kennel in parentheses", () => {
    const events = parseHistoryEvents(HISTORY_HTML, config);
    const sdEvent = events.find((e) => e.kennelTag === "SDH3");

    expect(sdEvent).toBeDefined();
    expect(sdEvent).toMatchObject({
      date: "2006-12-03",
      kennelTag: "SDH3",
      startTime: "18:30",
      title: "The Cold Moon",
      sourceUrl: "https://sdh3.com/e/event-20061203183000.shtml",
    });
  });

  it("maps kennel name via kennelNameMap", () => {
    const events = parseHistoryEvents(HISTORY_HTML, config);
    const irEvent = events.find((e) => e.kennelTag === "IRH3");

    expect(irEvent).toBeDefined();
    expect(irEvent).toMatchObject({
      date: "2007-01-05",
      kennelTag: "IRH3",
      title: "New Year Hash",
    });
  });

  it("skips entries with no parenthetical (no kennel)", () => {
    const events = parseHistoryEvents(HISTORY_HTML, config);
    // "Valentine Bash" has no kennel parenthetical, should be skipped
    const valentine = events.find((e) => e.title === "Valentine Bash");
    expect(valentine).toBeUndefined();
  });

  it("skips entries with unknown kennel name", () => {
    const events = parseHistoryEvents(HISTORY_HTML, config);
    // "Unknown Kennel" is not in kennelNameMap
    const unknown = events.find((e) => e.title === "St Patty's Warm-up");
    expect(unknown).toBeUndefined();
  });

  it("constructs sourceUrl from link href", () => {
    const events = parseHistoryEvents(HISTORY_HTML, config);
    const sdEvent = events.find((e) => e.kennelTag === "SDH3");
    expect(sdEvent?.sourceUrl).toBe(
      "https://sdh3.com/e/event-20061203183000.shtml",
    );
  });
});

// ── SDH3Adapter integration ──

describe("SDH3Adapter", () => {
  const adapter = new SDH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("rejects invalid config", async () => {
    const source = makeSource({ config: null });
    await expect(adapter.fetch(source)).rejects.toThrow("source.config is null");
  });

  it("fetches and parses hareline events", async () => {
    mockFetchResponse(HARELINE_HTML);

    const source = makeSource();
    const result = await adapter.fetch(source, { days: 365 });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.structureHash).toBe("mock-hash-sdh3");
    expect(result.diagnosticContext?.harelineEventsParsed).toBeGreaterThan(0);
    expect(result.diagnosticContext?.includeHistory).toBe(false);
  });

  it("fetches both hareline and history when includeHistory is true", async () => {
    // First call returns hareline, second returns history
    mockedSafeFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(HARELINE_HTML),
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(HISTORY_HTML),
        headers: new Headers(),
      } as Response);

    const source = makeSource({
      config: {
        kennelCodeMap: { SDH3: "SDH3", IRH3: "IRH3" },
        kennelNameMap: { "San Diego": "SDH3", "Iron Rule": "IRH3" },
        includeHistory: true,
      },
    });

    const result = await adapter.fetch(source, { days: 36500 });

    expect(mockedSafeFetch).toHaveBeenCalledTimes(2);
    expect(result.diagnosticContext?.includeHistory).toBe(true);
    expect(result.diagnosticContext?.harelineEventsParsed).toBeGreaterThan(0);
    expect(result.diagnosticContext?.historyEventsParsed).toBeGreaterThan(0);
  });

  it("deduplicates: hareline event wins over history event for same date+kennel", async () => {
    // Create a hareline with a SDH3 event on 2006-12-03 (same date as history)
    const harelineWithOverlap = `<html><body>
<dl>
  <dt class="hashEvent SDH3">
    <strong>San Diego H3</strong>
    <span style="white-space:nowrap">Sunday, December 3, 2006 6:30pm</span>
    <div>
      <strong>Hare(s):</strong> Special Hare<br>
      <strong>Address:</strong> 456 Overlap Ave, San Diego, CA
    </div>
  </dt>
</dl>
</body></html>`;

    mockedSafeFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(harelineWithOverlap),
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(HISTORY_HTML),
        headers: new Headers(),
      } as Response);

    const source = makeSource({
      config: {
        kennelCodeMap: { SDH3: "SDH3", IRH3: "IRH3" },
        kennelNameMap: { "San Diego": "SDH3", "Iron Rule": "IRH3" },
        includeHistory: true,
      },
    });

    const result = await adapter.fetch(source, { days: 36500 });

    // Find the SDH3 event on 2006-12-03 — hareline should win with richer data
    const overlapEvents = result.events.filter(
      (e) => e.date === "2006-12-03" && e.kennelTag === "SDH3",
    );
    expect(overlapEvents).toHaveLength(1);
    expect(overlapEvents[0].hares).toBe("Special Hare");
    expect(overlapEvents[0].location).toBe("456 Overlap Ave, San Diego, CA");
  });

  it("handles fetch error gracefully", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const source = makeSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("filters events by date window", async () => {
    // Create events spanning a wide range — only those within the window should remain
    const farFutureHareline = `<html><body>
<dl>
  <dt class="hashEvent SDH3">
    <strong>San Diego H3</strong>
    <span style="white-space:nowrap">Friday, March 20, 2099 6:00pm</span>
    <div><strong>Hare(s):</strong> Future Hare</div>
  </dt>
  <dt class="hashEvent SDH3">
    <strong>San Diego H3</strong>
    <span style="white-space:nowrap">Friday, March 20, 2026 6:00pm</span>
    <div><strong>Hare(s):</strong> Current Hare</div>
  </dt>
</dl>
</body></html>`;

    mockFetchResponse(farFutureHareline);

    const source = makeSource();
    const result = await adapter.fetch(source, { days: 90 });

    // Far future event (2099) should be filtered out by 90-day window
    const futureEvent = result.events.find((e) => e.date === "2099-03-20");
    expect(futureEvent).toBeUndefined();

    // Near-term event should be included
    const currentEvent = result.events.find((e) => e.date === "2026-03-20");
    expect(currentEvent).toBeDefined();
  });
});
