import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseEventCell,
  extractRunNumber,
  extractHare,
  extractLocation,
  extractMapsUrl,
  extractFee,
  YokoYokoH3Adapter,
} from "./yoko-yoko-h3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-y2h3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-y2h3",
    name: "Yoko Yoko H3 Website",
    url: "https://y2h3.net/",
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

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers(),
  } as Response);
}

// --- Fixtures based on real y2h3.net ---

const CELL_ST_PATRICKS = `
<span class="eventheader"><a href="https://www.facebook.com/events/3447496262067603" target="_blank">Yoko Yoko Hash, St. Patrick's Hash</a></span><br />
<span class="eventdate">Friday, March 20, 2026 - 7:00 PM</span><br /><br />
<a href="images/y2h3_091.jpg"><img class="eventbanner" src="images/y2h3_091_thumb.jpg" /></a><br /><br />
WHAT: Yoko Yoko Hash - A-B Live HARE!!!<br />When: Mar. 20 2026, 7pm<br />Theme: St. Patrick's Day<br />Where: YRP Nobi Station, follow arrows<br />Hare: Gerbil Stuffer<br />Requirements: Bring a flashlight<br /><br />
`;

const CELL_RUN_75 = `
<span class="eventheader"><a href="https://www.facebook.com/events/1804848436799561" target="_blank">Friday the 13th, Red Dress Run</a></span><br />
<span class="eventdate">Friday, February 13, 2026 - 7:00 PM</span><br /><br />
<a href="images/y2h3_090.jpg"><img class="eventbanner" src="images/y2h3_090_thumb.jpg" /></a><br /><br />
Run #75<br />Hare : Chinkasu<br />Location: Yokosuka Chuo West Exit (More's City side), Hirasaka Koen<br />Registration start : 6:30 PM<br />Bring your Red Dress On!<br /><br />
`;

const CELL_WITH_MAP = `
<span class="eventheader"><a href="https://www.facebook.com/events/1518648975911941" target="_blank">January2026 Hash #74 - 2026 New Year Drinking</a></span><br />
<span class="eventdate">Friday, January 23, 2026 - 7:00 PM</span><br /><br />
<a href="images/y2h3_089.jpg"><img class="eventbanner" src="images/y2h3_089_thumb.jpg" /></a><br /><br />
Start : Uraga station (Keikyu Line)<br />Cost: pay your own drinks and food<br />Hare : Code Poo<br />Map : https://maps.app.goo.gl/1fZyK8ah4jbMhehj7?g_st=ic<br /><br />
`;

const CELL_HALLOWEEN = `
<span class="eventheader"><a href="https://www.facebook.com/events/1360986525522582" target="_blank">Yoko Yoko October Hash #71 - HalloweenJoint Hash with Sake H3</a></span><br />
<span class="eventdate">Friday, October 31, 2025 - 7:30 PM</span><br /><br />
<a href="images/y2h3_086.jpg"><img class="eventbanner" src="images/y2h3_086_thumb.jpg" /></a><br /><br />
Location: Arrows from Omori station (Keihin Tohoku line), North (not East) Exit<br />Time: 19.30<br />Hares: Jelly Mouth and Crusader<br /><br />
`;

const CELL_NO_DATE = `
<span class="eventheader"><a href="https://example.com" target="_blank">Mystery Event</a></span><br />
<span class="eventdate"></span><br /><br />
Some random text<br />
`;

// --- Unit Tests ---

describe("extractRunNumber", () => {
  it("parses Run #75", () => {
    expect(extractRunNumber("Run #75")).toBe(75);
  });

  it("parses standalone #75", () => {
    expect(extractRunNumber("#75")).toBe(75);
  });

  it("parses Run Count #58", () => {
    expect(extractRunNumber("September Hash - Run Count #58")).toBe(58);
  });

  it("parses run# 64", () => {
    expect(extractRunNumber("March Hash - run# 64")).toBe(64);
  });

  it("returns undefined for no match", () => {
    expect(extractRunNumber("no number here")).toBeUndefined();
  });
});

describe("extractHare", () => {
  it("parses single hare", () => {
    expect(extractHare("Hare: Gerbil Stuffer")).toBe("Gerbil Stuffer");
  });

  it("parses hare with space before colon", () => {
    expect(extractHare("Hare : Chinkasu")).toBe("Chinkasu");
  });

  it("parses multiple hares", () => {
    expect(extractHare("Hares: Jelly Mouth and Crusader")).toBe(
      "Jelly Mouth and Crusader",
    );
  });

  it("parses Live Hare", () => {
    expect(extractHare("Live Hare: Peggy Ashuka")).toBe("Peggy Ashuka");
  });

  it("truncates at next field boundary", () => {
    expect(
      extractHare("Hare: Gerbil Stuffer\nRequirements: Bring a flashlight"),
    ).toBe("Gerbil Stuffer");
  });

  it("returns undefined for no match", () => {
    expect(extractHare("no hare info")).toBeUndefined();
  });
});

describe("extractLocation", () => {
  it("parses Where: field", () => {
    expect(extractLocation("Where: YRP Nobi Station, follow arrows")).toBe(
      "YRP Nobi Station, follow arrows",
    );
  });

  it("parses Location: field", () => {
    expect(
      extractLocation("Location: Yokosuka Chuo West Exit (More's City side)"),
    ).toBe("Yokosuka Chuo West Exit (More's City side)");
  });

  it("parses Venue: field", () => {
    expect(extractLocation("Venue: Noukendai (Noukendai Horiguchi Kita Park)")).toBe(
      "Noukendai (Noukendai Horiguchi Kita Park)",
    );
  });

  it("truncates at Hare: boundary", () => {
    expect(
      extractLocation("Location: Omori station\nHare: Someone"),
    ).toBe("Omori station");
  });

  it("returns undefined for no match", () => {
    expect(extractLocation("just some text")).toBeUndefined();
  });
});

describe("extractMapsUrl", () => {
  it("extracts maps.app.goo.gl URL", () => {
    expect(
      extractMapsUrl("Map : https://maps.app.goo.gl/1fZyK8ah4jbMhehj7?g_st=ic"),
    ).toBe("https://maps.app.goo.gl/1fZyK8ah4jbMhehj7?g_st=ic");
  });

  it("extracts google.com/maps URL", () => {
    expect(
      extractMapsUrl('href="https://www.google.com/maps/place/somewhere"'),
    ).toBe("https://www.google.com/maps/place/somewhere");
  });

  it("strips trailing ellipsis", () => {
    expect(
      extractMapsUrl("https://maps.app.goo.gl/abc123..."),
    ).toBe("https://maps.app.goo.gl/abc123");
  });

  it("returns undefined for no match", () => {
    expect(extractMapsUrl("no url here")).toBeUndefined();
  });
});

describe("extractFee", () => {
  it("parses Cost: field with yen", () => {
    expect(extractFee("Cost: 500 yen")).toBe("500 yen");
  });

  it("parses Fee: field", () => {
    expect(extractFee("Fee: 1500 JPY")).toBe("1500 JPY");
  });

  it("parses Entry Fee", () => {
    expect(extractFee("Entry Fee: 500 Yen")).toBe("500 Yen");
  });

  it("parses standalone yen amount", () => {
    expect(extractFee("bring 500 yen")).toBe("500 yen");
  });

  it("returns undefined for no fee", () => {
    expect(extractFee("free event")).toBeUndefined();
  });
});

describe("parseEventCell", () => {
  it("parses St. Patrick's Hash cell", () => {
    const event = parseEventCell(CELL_ST_PATRICKS, "https://y2h3.net/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-20");
    expect(event!.kennelTags[0]).toBe("yoko-yoko-h3");
    expect(event!.title).toBe("Yoko Yoko Hash, St. Patrick's Hash");
    expect(event!.startTime).toBe("19:00");
    expect(event!.hares).toBe("Gerbil Stuffer");
    expect(event!.location).toBe("YRP Nobi Station, follow arrows");
    expect(event!.externalLinks).toEqual([
      { url: "https://www.facebook.com/events/3447496262067603", label: "Facebook Event" },
    ]);
  });

  it("parses Run #75 cell with location", () => {
    const event = parseEventCell(CELL_RUN_75, "https://y2h3.net/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-13");
    expect(event!.runNumber).toBe(75);
    expect(event!.hares).toBe("Chinkasu");
    expect(event!.location).toContain("Yokosuka Chuo West Exit");
  });

  it("parses cell with Google Maps URL", () => {
    const event = parseEventCell(CELL_WITH_MAP, "https://y2h3.net/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-01-23");
    // Run number #74 is in the title span, not body text — extractRunNumber only checks body
    expect(event!.hares).toBe("Code Poo");
    expect(event!.locationUrl).toBe(
      "https://maps.app.goo.gl/1fZyK8ah4jbMhehj7?g_st=ic",
    );
  });

  it("parses Halloween joint hash cell", () => {
    const event = parseEventCell(CELL_HALLOWEEN, "https://y2h3.net/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2025-10-31");
    expect(event!.startTime).toBe("19:30");
    expect(event!.hares).toBe("Jelly Mouth and Crusader");
    expect(event!.location).toContain("Omori station");
  });

  it("returns null for cell with no date", () => {
    const event = parseEventCell(CELL_NO_DATE, "https://y2h3.net/");
    expect(event).toBeNull();
  });
});

// --- Integration test ---

describe("YokoYokoH3Adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a page with multiple events", async () => {
    const html = `<html><body>
      <table id="hareline">
        <tr><td>${CELL_ST_PATRICKS}</td></tr>
        <tr><td>${CELL_RUN_75}</td></tr>
        <tr><td>${CELL_HALLOWEEN}</td></tr>
      </table>
    </body></html>`;

    mockFetchResponse(html);

    const adapter = new YokoYokoH3Adapter();
    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBe("mock-hash-y2h3");
    expect(result.events[0].date).toBe("2026-03-20");
    expect(result.events[1].runNumber).toBe(75);
    expect(result.events[2].date).toBe("2025-10-31");
  });

  it("handles fetch error gracefully", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const adapter = new YokoYokoH3Adapter();
    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("503");
  });

  it("skips rows with no parseable content", async () => {
    const html = `<html><body>
      <table id="hareline">
        <tr><td>Just some random text with no date span</td></tr>
        <tr><td>${CELL_ST_PATRICKS}</td></tr>
      </table>
    </body></html>`;

    mockFetchResponse(html);

    const adapter = new YokoYokoH3Adapter();
    const result = await adapter.fetch(makeSource());

    // Only the St. Patrick's event should parse
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Yoko Yoko Hash, St. Patrick's Hash");
  });
});
