import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  parseEventSection,
  extractEventsFromDOM,
  extractEventsFromGallery,
  parseGalleryDate,
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

// Real HTML fixture — mirrors the structure of ah3.nl/nextruns/
const FIXTURE_HTML = `<html><body><div class="entry-content">
<style>mark { background-color: lightgrey; color: black; }</style>
<hr class="wp-block-separator"/>
<div style='text-align:center'><font size=5><b>
<p id=1477>Do Not Eat Yellow Snow !</b></font></p>
<p>Run № <b> 1477 </b>by <b>  Golden Showers  </b><br/>
<b>Sunday 12 April, 2026</b> at <b>12:45</b> hrs<br/>
<b>Near Station Lelylaan</b><br/>
9M5R+65, Amsterdam, 1077 XS, <a href="https://maps.google.com"><button>Map</button></a></p>
<div style='line-height:30px'>
<p>An early run at 13:00 hrs. Golden Showers is our hare and he has to rush to the airport.</p>
<p><i>Logistics: Bag Drop and Beer will be on Corelis Lelylaan.</i></p>
<small>___good_to_know<br/>
Bag Drop – Yes<br/>
BeerMeister – Slippery Edge<br/>
Hash Cash – €5<br/>
On After – We discuss before/during/after the run/circle<br/>
</small></div>
</div>
<hr class="wp-block-separator"/>
<div style='text-align:center'><font size=5><b>
<p id=1478>Tulip Hash</b></font></p>
<p>Run № <b> 1478 </b>by <b>  Cumming Home  </b><br/>
<b>Saturday 18 April, 2026</b> at <b>14:45</b> hrs<br/>
<b>somewhere</b></p>
<div style='line-height:30px'>
<p>Cumming Home makes us find tulips everywhere from a completely virginal run site.</p>
<small>___good_to_know<br/>
Bag Drop – Yes<br/>
Hash Cash – €5<br/>
On After – BBQ probably<br/>
</small></div>
</div>
<hr class="wp-block-separator"/>
<div style='text-align:center'><font size=5><b>
<p id=1479>NOT The KoningsDag Run</b></font></p>
<p>Run № <b> 1479 </b>by <b>  Hard Drive, Pink Panter  </b><br/>
<b>Sunday 26 April, 2026</b> at <b>14:45</b> hrs<br/>
<b>Hard Drive&#8217;s Shenanigans &#038; Mischief Center</b><br/>
Brouwersgracht 72-2, Amsterdam, 1013 GX, <a href="#"><button>Map</button></a></p>
<div style='line-height:30px'>
<p>The World looks a lot better through orange glasses.</p>
</div>
</div>
<hr class="wp-block-separator"/>
</div></body></html>`;

// ── Unit tests: parseEventSection ──

describe("parseEventSection — DOM-based event parsing", () => {
  const $ = cheerio.load(FIXTURE_HTML);
  const content = $(".entry-content");
  const hrs = content.find("hr").toArray();

  /** Walk sibling nodes between hrs[idx] and hrs[idx+1] (or end of content).
   *  Uses .at() for the index lookup so eslint-plugin-security doesn't flag
   *  the dynamic access as an object-injection sink. */
  function getSection(idx: number) {
    const hr = hrs.at(idx);
    if (!hr) throw new Error(`No <hr> at index ${idx}`);
    const nextHr = hrs.at(idx + 1) ?? null;
    const sectionNodes: import("domhandler").AnyNode[] = [];
    let node: import("domhandler").AnyNode | null = (hr as import("domhandler").Element).nextSibling;
    while (node && node !== nextHr) {
      sectionNodes.push(node);
      node = node.nextSibling;
    }
    return $(sectionNodes);
  }

  it("extracts title from <p id=NNNN> (not from the previous block's good_to_know text) (#559)", () => {
    const event = parseEventSection(getSection(0), $, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("AH3 #1477 — Do Not Eat Yellow Snow !");
    expect(event!.title).not.toContain("On After");
    expect(event!.title).not.toContain("Bag Drop");
  });

  it("extracts run number, hares, date/time, location", () => {
    const event = parseEventSection(getSection(0), $, SOURCE_URL);
    expect(event!.runNumber).toBe(1477);
    expect(event!.hares).toBe("Golden Showers");
    expect(event!.date).toBe("2026-04-12");
    expect(event!.startTime).toBe("12:45");
    expect(event!.location).toBe("Near Station Lelylaan");
    expect(event!.kennelTag).toBe("ah3-nl");
  });

  it("extracts description text between header and ___good_to_know (#563)", () => {
    const event = parseEventSection(getSection(0), $, SOURCE_URL);
    expect(event!.description).toContain("Golden Showers is our hare");
    // Description includes the logistics paragraph (it's body text, not metadata)
    expect(event!.description).toContain("Logistics");
    // But the ___good_to_know metadata block is excluded
    expect(event!.description).not.toContain("___good_to_know");
    expect(event!.description).not.toContain("BeerMeister");
    // "Bag Drop – Yes" is metadata; "Bag Drop and Beer" is description — both
    // contain "Bag Drop" but only the metadata line should be excluded
    expect(event!.description).not.toContain("Bag Drop – Yes");
  });

  it("strips 'somewhere' placeholder from location", () => {
    const event = parseEventSection(getSection(1), $, SOURCE_URL);
    expect(event!.location).toBeUndefined();
  });

  it("parses the second event correctly (after the first block's good_to_know)", () => {
    const event = parseEventSection(getSection(1), $, SOURCE_URL);
    expect(event!.title).toBe("AH3 #1478 — Tulip Hash");
    expect(event!.runNumber).toBe(1478);
    expect(event!.hares).toBe("Cumming Home");
    expect(event!.date).toBe("2026-04-18");
    expect(event!.description).toContain("tulips everywhere");
  });

  it("extracts street address with postal code", () => {
    const event = parseEventSection(getSection(2), $, SOURCE_URL);
    expect(event!.location).toContain("Shenanigans");
    expect(event!.locationStreet).toContain("Brouwersgracht 72-2");
    expect(event!.locationStreet).toContain("1013 GX");
  });
});

// ── extractEventsFromDOM ──

describe("extractEventsFromDOM", () => {
  it("finds all 3 events in the fixture", () => {
    const $ = cheerio.load(FIXTURE_HTML);
    const { events, errors } = extractEventsFromDOM($, SOURCE_URL);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.runNumber)).toEqual([1477, 1478, 1479]);
  });

  it("returns empty when .entry-content is missing", () => {
    const $ = cheerio.load("<html><body>No content</body></html>");
    const { events } = extractEventsFromDOM($, SOURCE_URL);
    expect(events).toHaveLength(0);
  });
});

// ── Gallery parser (/previous/ page) ──

describe("parseGalleryDate", () => {
  it("parses 'Saturday, Apr 4th, 2026 2:45PM'", () => {
    const result = parseGalleryDate("Saturday, Apr 4th, 2026 2:45PM");
    expect(result).toEqual({ date: "2026-04-04", startTime: "14:45" });
  });

  it("parses 'Sunday, Mar 8th, 2026 2:45PM'", () => {
    const result = parseGalleryDate("Sunday, Mar 8th, 2026 2:45PM");
    expect(result).toEqual({ date: "2026-03-08", startTime: "14:45" });
  });

  it("handles 1st/2nd/3rd ordinals", () => {
    expect(parseGalleryDate("Saturday, Jun 1st, 2025 2:45PM")?.date).toBe("2025-06-01");
    expect(parseGalleryDate("Sunday, Aug 2nd, 2025 2:45PM")?.date).toBe("2025-08-02");
    expect(parseGalleryDate("Saturday, May 3rd, 2025 2:45PM")?.date).toBe("2025-05-03");
  });

  it("returns null for empty string", () => {
    expect(parseGalleryDate("")).toBeNull();
  });
});

describe("extractEventsFromGallery", () => {
  const GALLERY_HTML = `<html><body><div class="entry-content">
<div class="harrier-gallery-grid">
<a class="harrier-gallery-tile-link" href="/rundetail?publiceventid=abc">
  <div class="harrier-gallery-tile">
    <div class="harrier-gallery-image"><img alt="The A to Birthday Run"></div>
    <h3>The A to Birthday Run</h3>
    <p><strong>Date:</strong> Saturday, Apr 4th, 2026 2:45PM</p>
    <p><strong>Location:</strong> Haarlem Railway Station</p>
    <p><strong>Hares:</strong> War 'n Piece &amp; MiaB</p>
    <p><strong>Description:</strong><br>&lt;b&gt;Saturday&lt;/b&gt; Birthday run from Haarlem.</p>
  </div>
</a>
<a class="harrier-gallery-tile-link" href="/rundetail?publiceventid=def">
  <div class="harrier-gallery-tile">
    <h3>No Run</h3>
    <p><strong>Date:</strong> Sunday, May 5th, 2024 2:45PM</p>
  </div>
</a>
</div>
</div></body></html>`;

  it("extracts events from gallery tiles with all fields", () => {
    const $ = cheerio.load(GALLERY_HTML);
    const { events, errors } = extractEventsFromGallery($, PREVIOUS_URL);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);

    expect(events[0].title).toBe("The A to Birthday Run");
    expect(events[0].date).toBe("2026-04-04");
    expect(events[0].startTime).toBe("14:45");
    expect(events[0].location).toBe("Haarlem Railway Station");
    expect(events[0].hares).toBe("War 'n Piece & MiaB");
    expect(events[0].description).toContain("Birthday run from Haarlem");
    expect(events[0].description).not.toContain("<b>");
    expect(events[0].kennelTag).toBe("ah3-nl");
    // sourceUrl should come from the tile's per-event href, not the listing page
    expect(events[0].sourceUrl).toContain("publiceventid=abc");
  });

  it("handles tiles with minimal fields (no location, hares, description)", () => {
    const $ = cheerio.load(GALLERY_HTML);
    const { events } = extractEventsFromGallery($, PREVIOUS_URL);
    expect(events[1].title).toBe("No Run");
    expect(events[1].date).toBe("2024-05-05");
    expect(events[1].hares).toBeUndefined();
    expect(events[1].location).toBeUndefined();
    expect(events[1].description).toBeUndefined();
  });
});

// ── Special event without Run № line ──

describe("special events without Run №", () => {
  const SPECIAL_HTML = `<html><body><div class="entry-content">
<hr/>
<p id="1">A Very Special FILTH Bicycle Hash</p>
<p><b>Saturday 29 August, 2026</b> at <b>12:00</b> hrs<br/>
<b>Central Station</b></p>
<p>Bring your bicycle for an adventure.</p>
<hr/>
</div></body></html>`;

  it("parses events without Run № using the <p id> title and skips placeholder IDs", () => {
    const $ = cheerio.load(SPECIAL_HTML);
    const { events } = extractEventsFromDOM($, SOURCE_URL);
    expect(events).toHaveLength(1);
    // id="1" is a placeholder — runNumber should be undefined
    expect(events[0].runNumber).toBeUndefined();
    expect(events[0].title).toBe("A Very Special FILTH Bicycle Hash");
    expect(events[0].date).toBe("2026-08-29");
    expect(events[0].description).toContain("Bring your bicycle");
  });
});

// ── Integration tests: AH3Adapter.fetch ──

describe("AH3Adapter", () => {
  const adapter = new AH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches upcoming + previous pages and deduplicates by run number", async () => {
    const upcomingHtml = FIXTURE_HTML;
    const previousHtml = `<html><body><div class="entry-content">
<hr/>
<p id=1477>Do Not Eat Yellow Snow !</p>
<p>Run № <b>1477</b> by <b>Golden Showers</b><br/>
<b>Sunday 12 April, 2026</b> at <b>12:45</b> hrs<br/>
<b>Station</b></p>
<hr/>
<p id=1475>Old Run</p>
<p>Run № <b>1475</b> by <b>Old Hare</b><br/>
<b>Saturday 28 March, 2026</b> at <b>14:45</b> hrs<br/>
<b>Central Station</b></p>
<hr/>
</div></body></html>`;

    mockFetchResponses(upcomingHtml, previousHtml);

    const result = await adapter.fetch(makeSource());
    expect(result.errors).toHaveLength(0);
    // Run 1477 appears in both, should only appear once (from upcoming)
    const run1477 = result.events.filter((e) => e.runNumber === 1477);
    expect(run1477).toHaveLength(1);
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
    let callCount = 0;
    mockedSafeFetch.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: () => Promise.resolve(FIXTURE_HTML),
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
    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Previous page fetch failed");
  });
});
