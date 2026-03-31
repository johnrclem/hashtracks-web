import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  parseEventBlock,
  extractTextBlocks,
  extractEvents,
  HagueH3Adapter,
} from "./hague-h3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-hague"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://haguehash.nl/";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-hague",
    name: "The Hague H3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: {},
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

// ── Unit tests: parseEventBlock ──

describe("parseEventBlock", () => {
  it("parses a standard event block", () => {
    const text = `Run 2412
When: Sunday, March 29
Time: 14:00 hr
Where: Parallelweg crossing Houtrustweg by Sportcity, The Hague
Hares: Balls on a Dyke
Cost: non-members EUR 7.00 for a single run (includes beer and snacks)`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-29");
    expect(event!.runNumber).toBe(2412);
    expect(event!.hares).toBe("Balls on a Dyke");
    expect(event!.startTime).toBe("14:00");
    expect(event!.location).toBe("Parallelweg crossing Houtrustweg by Sportcity, The Hague");
    expect(event!.kennelTag).toBe("hagueh3");
    expect(event!.title).toBe("Hague H3 #2412");
  });

  it("parses event with parenthetical suffix in run number", () => {
    const text = `Run 2411 (50+% run)
When: Sunday, March 22
Time: 14:00 hr
Where: Station Voorburg under the viaduct
Hare: XL`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2411);
    expect(event!.hares).toBe("XL");
  });

  it("parses non-standard time with dot separator", () => {
    const text = `Run 2410 (10.45 St Patrick's Day Run)
When: Sunday, March 15
Time: 10.45 hr (Different From Normal)
Where: Stuyvesantplein Link
Hares: RD aka Lazy`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.startTime).toBe("10:45");
    expect(event!.location).toBe("Stuyvesantplein");
  });

  it("strips trailing Link from location", () => {
    const text = `Run 2409
When: Sunday, March 8
Time: 14:00 hr
Where: Rotterdamseweg near Vliet canal Link
Hares: DW`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("Rotterdamseweg near Vliet canal");
  });

  it("parses Hare(s) variant", () => {
    const text = `Run 2406 (Layer takes requests run)
When: Sunday Februari 22th
Hare(s): Layer (and maybe our hashflash FaD)
Time: 14:00 hr
Where: Wijndaelerweg by the entrance golf course Ockenburgh`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Layer (and maybe our hashflash FaD)");
  });

  it("parses event with title before run number", () => {
    const text = `Windmill Poker Run
When: Sunday February 15th
Hare: Ironic Maiden
Time: 14:00 hr
Where: Zwembad Hillegersberg`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Hague H3 — Windmill Poker Run");
    expect(event!.runNumber).toBeUndefined();
    expect(event!.hares).toBe("Ironic Maiden");
    expect(event!.location).toBe("Zwembad Hillegersberg");
  });

  it("returns null if no When: line present", () => {
    const text = `Run 2412
No date info here
Where: Some place`;

    expect(parseEventBlock(text, SOURCE_URL)).toBeNull();
  });

  it("handles & in hare names", () => {
    const text = `Run 2408
When: Sunday, March 1
Time: 14:00 hr
Where: Station 't Loo
Hares: DownDown & MyLady`;

    const event = parseEventBlock(text, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("DownDown & MyLady");
  });
});

// ── Unit tests: extractTextBlocks ──

describe("extractTextBlocks", () => {
  it("extracts text from WPBakery sections", () => {
    const html = `<html><body>
<section class="l-section"><div class="l-section-h"><div class="g-cols"><div class="vc_col-sm-12 wpb_column"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column"><div class="wpb_wrapper">
<p>Run 2412<br/>When: Sunday, March 29<br/>Time: 14:00 hr<br/>Where: The Hague<br/>Hares: Test Hare</p>
<p>OnOn</p>
</div></div></div></div></div></div></div></section>
<section class="l-section"><div class="l-section-h"><div class="g-cols"><div class="vc_col-sm-12 wpb_column"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column"><div class="wpb_wrapper">
<p>Run 2411<br/>When: Sunday, March 22<br/>Time: 14:00 hr<br/>Where: Voorburg<br/>Hare: XL</p>
<p>OnOn</p>
</div></div></div></div></div></div></div></section>
</body></html>`;

    const $ = cheerio.load(html);
    const blocks = extractTextBlocks($);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks[0]).toContain("Run 2412");
    expect(blocks[1]).toContain("Run 2411");
  });

  it("skips short blocks", () => {
    const html = `<html><body>
<section class="l-section"><div class="l-section-h"><div class="g-cols"><div class="vc_col-sm-12 wpb_column"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column"><div class="wpb_wrapper">
<p>Short</p>
</div></div></div></div></div></div></div></section>
</body></html>`;

    const $ = cheerio.load(html);
    const blocks = extractTextBlocks($);
    expect(blocks).toHaveLength(0);
  });
});

// ── Unit tests: extractEvents ──

describe("extractEvents", () => {
  it("parses multiple event blocks", () => {
    const blocks = [
      `Run 2412\nWhen: Sunday, March 29\nTime: 14:00 hr\nWhere: The Hague\nHares: Balls on a Dyke`,
      `Run 2411 (50+% run)\nWhen: Sunday, March 22\nTime: 14:00 hr\nWhere: Station Voorburg\nHare: XL`,
    ];

    const { events, errors } = extractEvents(blocks, SOURCE_URL);
    expect(errors).toHaveLength(0);
    expect(events).toHaveLength(2);
    expect(events[0].runNumber).toBe(2412);
    expect(events[1].runNumber).toBe(2411);
  });

  it("skips blocks without When: lines", () => {
    const blocks = [
      `Some random footer text about beer`,
      `Run 2412\nWhen: Sunday, March 29\nTime: 14:00 hr\nWhere: The Hague\nHares: Test`,
    ];

    const { events } = extractEvents(blocks, SOURCE_URL);
    expect(events).toHaveLength(1);
  });
});

// ── Integration tests: HagueH3Adapter.fetch ──

describe("HagueH3Adapter", () => {
  const adapter = new HagueH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches and parses events from WPBakery page", async () => {
    const html = `<html><body>
<section class="l-section"><div class="l-section-h"><div class="g-cols"><div class="vc_col-sm-12 wpb_column"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column"><div class="wpb_wrapper">
<p>Run 2412<br/>When: Sunday, March 29<br/>Time: 14:00 hr<br/>Where: Parallelweg crossing Houtrustweg, The Hague<br/>Hares: Balls on a Dyke<br/>Cost: non-members EUR 7.00</p>
<p>OnOn</p>
</div></div></div></div></div></div></div></section>
<section class="l-section"><div class="l-section-h"><div class="g-cols"><div class="vc_col-sm-12 wpb_column"><div class="vc_column-inner"><div class="wpb_wrapper"><div class="wpb_text_column"><div class="wpb_wrapper">
<p>Run 2411 (50+% run)<br/>When: Sunday, March 22<br/>Time: 14:00 hr<br/>Where: Station Voorburg<br/>Hare: XL<br/>Cost: non-members EUR 7.00</p>
<p>OnOn</p>
</div></div></div></div></div></div></div></section>
</body></html>`;

    mockedSafeFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(html),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response);

    const result = await adapter.fetch(makeSource());
    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThanOrEqual(2);
    expect(result.events[0].runNumber).toBe(2412);
    expect(result.events[0].kennelTag).toBe("hagueh3");
  });

  it("handles fetch failure gracefully", async () => {
    mockedSafeFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const result = await adapter.fetch(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
