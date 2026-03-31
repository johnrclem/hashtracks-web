import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseEventBlock,
  parseEuropeanDate,
  expandYear,
  parseFutureDates,
  extractEvents,
  BruH3Adapter,
} from "./bruh3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-bruh3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "http://www.bruh3.eu/blog/";
const WRITEUPS_URL = "http://www.bruh3.eu/blog-2/";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-bruh3",
    name: "BruH3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { writeUpsUrl: WRITEUPS_URL },
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

function mockFetchResponses(upcomingHtml: string, writeUpsHtml: string) {
  let callCount = 0;
  mockedSafeFetch.mockImplementation(async () => {
    callCount++;
    const html = callCount === 1 ? upcomingHtml : writeUpsHtml;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(html),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response;
  });
}

// ── Unit tests: expandYear ──

describe("expandYear", () => {
  it("maps 26 to 2026", () => {
    expect(expandYear(26)).toBe(2026);
  });

  it("maps 00 to 2000", () => {
    expect(expandYear(0)).toBe(2000);
  });

  it("maps 99 to 1999", () => {
    expect(expandYear(99)).toBe(1999);
  });

  it("maps 49 to 2049", () => {
    expect(expandYear(49)).toBe(2049);
  });

  it("maps 50 to 1950", () => {
    expect(expandYear(50)).toBe(1950);
  });
});

// ── Unit tests: parseEuropeanDate ──

describe("parseEuropeanDate", () => {
  it("parses DD.MM.YY to YYYY-MM-DD", () => {
    expect(parseEuropeanDate("28.03.26")).toBe("2026-03-28");
  });

  it("parses date embedded in text", () => {
    expect(parseEuropeanDate("Hash 2339: 28.03.26")).toBe("2026-03-28");
  });

  it("returns null for invalid text", () => {
    expect(parseEuropeanDate("no date here")).toBeNull();
  });

  it("handles 2025 dates", () => {
    expect(parseEuropeanDate("15.12.25")).toBe("2025-12-15");
  });

  it("rejects invalid month", () => {
    expect(parseEuropeanDate("15.13.26")).toBeNull();
  });
});

// ── Unit tests: parseEventBlock ──

describe("parseEventBlock", () => {
  it("parses a standard upcoming event block", () => {
    const block = `
Hash 2339:     28.03.26

Hare:     John & Alison

Start & après:    8 Kaberg, 3090 Overijse

Public transport: De Lijn buses R75 from Etterbeek
    `.trim();

    const event = parseEventBlock(block, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-28");
    expect(event!.kennelTag).toBe("bruh3");
    expect(event!.runNumber).toBe(2339);
    expect(event!.title).toBe("BruH3 #2339");
    expect(event!.hares).toBe("John & Alison");
    expect(event!.location).toBe("8 Kaberg, 3090 Overijse");
    expect(event!.startTime).toBe("15:00");
    expect(event!.sourceUrl).toBe(SOURCE_URL);
  });

  it("parses a write-up event block (no colon after Hash)", () => {
    const block = `
Hash 2338  21.03.26
Hare: Tim (with help from Susan)
Start and après: car park at back entrance to Château de la Hulpe
Some write-up text about the trail follows here...
    `.trim();

    const event = parseEventBlock(block, WRITEUPS_URL);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-21");
    expect(event!.runNumber).toBe(2338);
    expect(event!.hares).toBe("Tim (with help from Susan)");
    expect(event!.location).toBe("car park at back entrance to Château de la Hulpe");
    expect(event!.sourceUrl).toBe(WRITEUPS_URL);
  });

  it("parses block with 'and' instead of '&' in Start line", () => {
    const block = `
Hash 2337  14.03.26
Hare: Peter
Start and apres: Some parking lot, 1000 Brussels
    `.trim();

    const event = parseEventBlock(block, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.location).toBe("Some parking lot, 1000 Brussels");
  });

  it("returns null for text without Hash number", () => {
    const block = "Just some random write-up text about the trail.";
    expect(parseEventBlock(block, SOURCE_URL)).toBeNull();
  });

  it("returns null for text without a date", () => {
    const block = "Hash 2339 — no date available";
    expect(parseEventBlock(block, SOURCE_URL)).toBeNull();
  });

  it("handles block with no location", () => {
    const block = `
Hash 2340:     04.04.26
Hare:     Christian & Harriet
    `.trim();

    const event = parseEventBlock(block, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2340);
    expect(event!.hares).toBe("Christian & Harriet");
    expect(event!.location).toBeUndefined();
  });

  it("handles block with no hare", () => {
    const block = `
Hash 2341:     11.04.26
Start & après: Bois de la Cambre
    `.trim();

    const event = parseEventBlock(block, SOURCE_URL);

    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2341);
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBe("Bois de la Cambre");
  });
});

// ── Unit tests: parseFutureDates ──

describe("parseFutureDates", () => {
  it("parses future date lines with hares", () => {
    const text = `Future Dates: volunteer to lay a Hash!

2026

April 11 - Ed
April 18 - The Bluebells (Peter Br), or Julian O.
April 25 - Julian O.
`;

    const events = parseFutureDates(text, SOURCE_URL, 2026);

    expect(events).toHaveLength(3);
    expect(events[0].date).toBe("2026-04-11");
    expect(events[0].hares).toBe("Ed");
    expect(events[0].kennelTag).toBe("bruh3");
    expect(events[0].startTime).toBe("15:00");

    expect(events[1].date).toBe("2026-04-18");
    expect(events[1].hares).toBe("The Bluebells (Peter Br), or Julian O.");

    expect(events[2].date).toBe("2026-04-25");
    expect(events[2].hares).toBe("Julian O.");
  });

  it("handles 'reserved' hares as undefined", () => {
    const text = `Future Dates:

2026

May 02 - reserved
May 09 - reserved
`;

    const events = parseFutureDates(text, SOURCE_URL, 2026);

    expect(events).toHaveLength(2);
    expect(events[0].date).toBe("2026-05-02");
    expect(events[0].hares).toBeUndefined();
    expect(events[1].date).toBe("2026-05-09");
    expect(events[1].hares).toBeUndefined();
  });

  it("uses referenceYear when no year header is present", () => {
    const text = `Future Dates:

June 01 - Alice
`;

    const events = parseFutureDates(text, SOURCE_URL, 2026);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-06-01");
  });

  it("returns empty array for text with no valid future date lines", () => {
    const text = `Future Dates: these dates are available!!!
all other Saturdays in 2026 available!`;

    const events = parseFutureDates(text, SOURCE_URL, 2026);

    expect(events).toHaveLength(0);
  });

  it("handles en-dash separator", () => {
    const text = `Future Dates:

2026

May 23\t\t- reserved
`;

    const events = parseFutureDates(text, SOURCE_URL, 2026);

    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-05-23");
  });
});

// ── Unit tests: extractEvents ──

describe("extractEvents", () => {
  it("extracts events from blocks separated by underscores", () => {
    const text = `
___________________________________________
Hash 2339:     28.03.26
Hare:     John & Alison
Start & après:    8 Kaberg, 3090 Overijse
___________________________________________
Hash 2340:     04.04.26
Hare:     Christian & Harriet
Start & après:    car park P1 Zoetwater
___________________________________________
    `.trim();

    const { events, errors } = extractEvents(text, SOURCE_URL);

    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0].runNumber).toBe(2339);
    expect(events[1].runNumber).toBe(2340);
  });

  it("extracts events + future dates from combined text", () => {
    const text = `
___________________________________________
Hash 2339:     28.03.26
Hare:     John
Start & après:    Overijse
___________________________________________
Future Dates: volunteer!

2026

April 11 - Ed
April 18 - Peter
___________________________________________
    `.trim();

    const { events } = extractEvents(text, SOURCE_URL);

    // 1 structured event + 2 future dates
    expect(events).toHaveLength(3);
    expect(events[0].runNumber).toBe(2339);
    expect(events[1].date).toBe("2026-04-11");
    expect(events[2].date).toBe("2026-04-18");
  });

  it("skips blocks without Hash number or date", () => {
    const text = `
___________________________________________
Just some info text about BruH3
___________________________________________
Hash 2339:     28.03.26
Hare:     John
___________________________________________
    `.trim();

    const { events } = extractEvents(text, SOURCE_URL);

    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(2339);
  });
});

// ── Integration tests: BruH3Adapter.fetch ──

describe("BruH3Adapter", () => {
  let adapter: BruH3Adapter;

  beforeEach(() => {
    adapter = new BruH3Adapter();
    vi.clearAllMocks();
  });

  it("fetches both pages, deduplicates by run number", async () => {
    const upcomingHtml = `<html><body>
      <div class="blog-entry-body">
        ___________________________________________
        Hash 2339:     28.03.26
        Hare:     John & Alison
        Start & apr&egrave;s:    8 Kaberg, 3090 Overijse
        ___________________________________________
        Hash 2340:     04.04.26
        Hare:     Christian & Harriet
        Start & apr&egrave;s:    car park P1 Zoetwater
        ___________________________________________
      </div>
    </body></html>`;

    const writeUpsHtml = `<html><body>
      <div class="blog-entry-body">
        ___________________________________________
        Hash 2339  28.03.26
        Hare: John & Alison
        Start and apr&egrave;s: 8 Kaberg, 3090 Overijse
        This was a lovely trail through the forest...
        ___________________________________________
        Hash 2338  21.03.26
        Hare: Tim (with help from Susan)
        Start and apr&egrave;s: Château de la Hulpe
        Another great write-up here...
        ___________________________________________
      </div>
    </body></html>`;

    mockFetchResponses(upcomingHtml, writeUpsHtml);

    const result = await adapter.fetch(makeSource());

    // 2339 from upcoming, 2340 from upcoming, 2338 from write-ups
    // 2339 from write-ups is deduplicated
    expect(result.events).toHaveLength(3);
    expect(result.events.map((e) => e.runNumber).sort()).toEqual([2338, 2339, 2340]);

    // Verify 2339 comes from upcoming (sourceUrl check)
    const ev2339 = result.events.find((e) => e.runNumber === 2339);
    expect(ev2339!.sourceUrl).toBe(SOURCE_URL);
  });

  it("returns upcoming events even if write-ups page fails", async () => {
    let callCount = 0;
    mockedSafeFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: () =>
            Promise.resolve(`<html><body>
            <div class="blog-entry-body">
              ___________________________________________
              Hash 2339:     28.03.26
              Hare:     John
              Start & après:    Overijse
              ___________________________________________
            </div>
          </body></html>`),
          headers: new Headers(),
        } as Response;
      }
      return {
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as Response;
    });

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(2339);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Write-ups page fetch failed");
  });

  it("includes future dates from upcoming page", async () => {
    const upcomingHtml = `<html><body>
      <div class="blog-entry-body">
        ___________________________________________
        Hash 2339:     28.03.26
        Hare:     John
        Start & après:    Overijse
        ___________________________________________
        Future Dates: volunteer!

        2026

        April 11 - Ed
        April 18 - Peter
        ___________________________________________
      </div>
    </body></html>`;

    const writeUpsHtml = `<html><body>
      <div class="blog-entry-body">Nothing here</div>
    </body></html>`;

    mockFetchResponses(upcomingHtml, writeUpsHtml);

    const result = await adapter.fetch(makeSource());

    // 1 structured event + 2 future dates
    expect(result.events.length).toBeGreaterThanOrEqual(3);

    const futureDateEvents = result.events.filter((e) => !e.runNumber);
    expect(futureDateEvents.length).toBe(2);
    expect(futureDateEvents[0].date).toBe("2026-04-11");
    expect(futureDateEvents[0].hares).toBe("Ed");
  });

  it("returns empty events on fetch failure", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
