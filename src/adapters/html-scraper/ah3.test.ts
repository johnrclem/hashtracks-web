import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseEventBlock,
  extractEvents,
  htmlToText,
  AH3Adapter,
} from "./ah3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-ah3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://ah3.nl/nextruns/";
const PREVIOUS_URL = "https://ah3.nl/previous/";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-ah3",
    name: "Amsterdam H3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { previousUrl: PREVIOUS_URL },
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

function mockFetchResponses(upcomingHtml: string, previousHtml: string) {
  let callCount = 0;
  mockedSafeFetch.mockImplementation(async () => {
    callCount++;
    const html = callCount === 1 ? upcomingHtml : previousHtml;
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(html),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response;
  });
}

// ── Unit tests: parseEventBlock ──

describe("parseEventBlock", () => {
  it("parses a full event block with title, run number, hares, date, location", () => {
    const text = `The A to Birthday Run
Run № 1476 by War 'n Piece & MiaB
Saturday 04 April, 2026 at 14:45 hrs
Haarlem Railway Station
Stationsplein , Haarlem, 2011 LR, Noord-Holland Map`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-04");
    expect(event!.runNumber).toBe(1476);
    expect(event!.hares).toBe("War 'n Piece & MiaB");
    expect(event!.startTime).toBe("14:45");
    expect(event!.location).toBe("Haarlem Railway Station");
    expect(event!.locationStreet).toBe("Stationsplein , Haarlem, 2011 LR, Noord-Holland");
    expect(event!.title).toBe("AH3 #1476 — The A to Birthday Run");
    expect(event!.kennelTag).toBe("ah3-nl");
  });

  it("parses event with early start time", () => {
    const text = `Do Not Eat Yellow Snow !
Run № 1477 by Golden Showers
Sunday 12 April, 2026 at 12:45 hrs
Near Station Zuid
Prinses Amaliaplein , Amsterdam, 1077 XS,`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-04-12");
    expect(event!.startTime).toBe("12:45");
    expect(event!.runNumber).toBe(1477);
    expect(event!.hares).toBe("Golden Showers");
  });

  it("handles event without hares (Click if you want to hare)", () => {
    const text = `May The Third Be With You
Run № 1480 Click if you want to hare this run
Sunday 03 May, 2026 at 14:45 hrs
somewhere`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1480);
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeUndefined(); // "somewhere" should be stripped
    expect(event!.date).toBe("2026-05-03");
  });

  it("returns null for blocks without a run number", () => {
    const text = `Some random text
without any run number or date.`;

    expect(parseEventBlock(text, SOURCE_URL)).toBeNull();
  });

  it("returns null for blocks without a date", () => {
    const text = `Run № 1476 by Someone
No date here, just text.`;

    expect(parseEventBlock(text, SOURCE_URL)).toBeNull();
  });

  it("skips leftover good_to_know instructions and picks correct title", () => {
    const text = `Bag Drop – NO ( but lockers inside the station )
The A to Birthday Run
Run № 1476 by War 'n Piece & MiaB
Saturday 04 April, 2026 at 14:45 hrs
Haarlem Railway Station`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("AH3 #1476 — The A to Birthday Run");
    expect(event!.title).not.toContain("Bag Drop");
  });

  it("parses title-less event (just run number)", () => {
    const text = `Run № 1481 by Slippery Edge
Sunday 10 May, 2026 at 14:45 hrs
somewhere`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("AH3 #1481");
    expect(event!.hares).toBe("Slippery Edge");
  });
});

// ── Unit tests: extractEvents ──

describe("extractEvents", () => {
  it("splits text on ___good_to_know markers and parses each block", () => {
    const text = `The A to Birthday Run
Run № 1476 by War 'n Piece & MiaB
Saturday 04 April, 2026 at 14:45 hrs
Haarlem Railway Station

___good_to_know
Bag Drop – NO
Hash Cash – €5

Do Not Eat Yellow Snow !
Run № 1477 by Golden Showers
Sunday 12 April, 2026 at 12:45 hrs
Near Station Zuid

___good_to_know
Bag Drop – Probably not`;

    const { events, errors } = extractEvents(text, SOURCE_URL);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0].runNumber).toBe(1476);
    expect(events[1].runNumber).toBe(1477);
  });

  it("skips blocks without run numbers", () => {
    const text = `Some intro text about Amsterdam H3.
___good_to_know
Run № 1476 by War 'n Piece & MiaB
Saturday 04 April, 2026 at 14:45 hrs
Haarlem Railway Station
___good_to_know
More footer text`;

    const { events } = extractEvents(text, SOURCE_URL);
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(1476);
  });
});

// ── Unit tests: htmlToText ──

describe("htmlToText", () => {
  it("extracts text from .entry-content with br→newline conversion", async () => {
    const $ = (await import("cheerio")).load(
      `<div class="entry-content"><p>Run № <b>1476</b> by <b>War</b><br/>Saturday 04 April, 2026 at 14:45 hrs</p></div>`,
    );
    const text = htmlToText($);
    expect(text).toContain("Run № 1476 by War");
    expect(text).toContain("Saturday 04 April, 2026 at 14:45 hrs");
  });

  it("returns empty string when .entry-content is missing", async () => {
    const $ = (await import("cheerio")).load(`<div>No entry content</div>`);
    expect(htmlToText($)).toBe("");
  });

  it("strips <style> tags so CSS rules don't appear as text", async () => {
    const $ = (await import("cheerio")).load(
      `<div class="entry-content"><style>mark { background-color: lightgrey; color: black; }</style><p>The A to Birthday Run</p></div>`,
    );
    const text = htmlToText($);
    expect(text).not.toContain("background-color");
    expect(text).not.toContain("mark {");
    expect(text).toContain("The A to Birthday Run");
  });
});

// ── Integration tests: AH3Adapter.fetch ──

describe("AH3Adapter", () => {
  const adapter = new AH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches upcoming + previous pages and deduplicates by run number", async () => {
    const upcomingHtml = `<html><body><div class="entry-content">
<h1>Run A</h1>
<p>Run № <b>1476</b> by <b>War &#039;n Piece</b><br/>
<b>Saturday 04 April, 2026</b> at <b>14:45</b> hrs<br/>
<b>Haarlem Station</b></p>
<p>___good_to_know</p>
</div></body></html>`;

    const previousHtml = `<html><body><div class="entry-content">
<h1>Run A Repeat</h1>
<p>Run № <b>1476</b> by <b>War &#039;n Piece</b><br/>
<b>Saturday 04 April, 2026</b> at <b>14:45</b> hrs<br/>
<b>Haarlem Station</b></p>
<p>___good_to_know</p>
<h1>Run B</h1>
<p>Run № <b>1475</b> by <b>Old Hare</b><br/>
<b>Saturday 28 March, 2026</b> at <b>14:45</b> hrs<br/>
<b>Central Station</b></p>
<p>___good_to_know</p>
</div></body></html>`;

    mockFetchResponses(upcomingHtml, previousHtml);

    const result = await adapter.fetch(makeSource());
    expect(result.errors).toHaveLength(0);
    // Run 1476 appears in both, should only appear once (from upcoming)
    const run1476 = result.events.filter((e) => e.runNumber === 1476);
    expect(run1476).toHaveLength(1);
    // Run 1475 only in previous
    const run1475 = result.events.filter((e) => e.runNumber === 1475);
    expect(run1475).toHaveLength(1);
  });

  it("handles fetch failure on upcoming page", async () => {
    mockedSafeFetch.mockResolvedValueOnce({
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

  it("continues with upcoming events if previous page fails", async () => {
    const upcomingHtml = `<html><body><div class="entry-content">
<h1>Run A</h1>
<p>Run № <b>1476</b> by <b>Hare</b><br/>
<b>Saturday 04 April, 2026</b> at <b>14:45</b> hrs<br/>
<b>Station</b></p>
<p>___good_to_know</p>
</div></body></html>`;

    let callCount = 0;
    mockedSafeFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(upcomingHtml),
          headers: new Headers(),
        } as Response;
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as Response;
    });

    const result = await adapter.fetch(makeSource());
    expect(result.events).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Previous page fetch failed");
  });
});
