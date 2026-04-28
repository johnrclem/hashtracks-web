import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import * as cheerio from "cheerio";
import { parseMakesweatEvent, extractMakesweatId } from "./city-hash";
import { CityHashAdapter } from "./city-hash";
import { chronoParseDate } from "../utils";

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

describe("chronoParseDate (en-GB, used by CityHash)", () => {
  it("parses ordinal date with short month", () => {
    expect(chronoParseDate("City Hash R*n #1910 - 24th Feb 2026", "en-GB")).toBe("2026-02-24");
  });

  it("parses 1st with full month", () => {
    expect(chronoParseDate("City Hash R*n #1915 - 1st March 2026", "en-GB")).toBe("2026-03-01");
  });

  it("parses 2nd", () => {
    expect(chronoParseDate("R*n #100 - 2nd Jan 2026", "en-GB")).toBe("2026-01-02");
  });

  it("parses 3rd", () => {
    expect(chronoParseDate("R*n #100 - 3rd April 2026", "en-GB")).toBe("2026-04-03");
  });

  it("parses 11th (not 1st)", () => {
    expect(chronoParseDate("R*n #100 - 11th December 2025", "en-GB")).toBe("2025-12-11");
  });

  it("returns null for missing date", () => {
    expect(chronoParseDate("City Hash R*n #1910", "en-GB")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(chronoParseDate("R*n #1 - 5th Flob 2026", "en-GB")).toBeNull();
  });
});

const SAMPLE_HTML = `
<div>
  <div class="ms_event makesweatevent-12345">
    <div class="ms_eventtitle">City Hash R*n #1912 International Women's Day @ The Old Star</div>
    <div class="ms_event_startdate">Tue 10th Mar 26</div>
    <div class="ms_eventstart">7:00pm</div>
    <div class="ms_eventdescription">Hare - Sort Yourself Out
Pub - The Old Star
Station - St James' Park</div>
    <div class="ms_venue_name">The Old Star</div>
    <div class="ms_venue_address">66 Broadway</div>
    <div class="ms_venue_postcode">SW1H 0DB</div>
    <div class="ms_venue_ptransport">St James's Park</div>
    <div class="ms_venue_notes"></div>
  </div>
  <div class="ms_event makesweatevent-12346">
    <div class="ms_eventtitle">City Hash R*n #1914 @ The Eagle</div>
    <div class="ms_event_startdate">Tue 24th Mar 26</div>
    <div class="ms_eventstart">7:00pm</div>
    <div class="ms_eventdescription">Hares - Zippy and Bungle
Pub - The Eagle</div>
    <div class="ms_venue_name">The Eagle</div>
    <div class="ms_venue_address">2 Shepherdess Walk</div>
    <div class="ms_venue_postcode">N1 7LB</div>
    <div class="ms_venue_ptransport">Old Street</div>
    <div class="ms_venue_notes">Nearest Tube is Old Street, Northern Line</div>
  </div>
  <div class="ms_event makesweatevent-12347">
    <div class="ms_eventtitle">City Hash R*n #1915 @ TBA</div>
    <div class="ms_event_startdate">Tue 31st Mar 26</div>
    <div class="ms_eventstart">7:00pm</div>
    <div class="ms_eventdescription">Hare - TBC</div>
    <div class="ms_venue_name">TBA</div>
    <div class="ms_venue_address"></div>
    <div class="ms_venue_postcode"></div>
    <div class="ms_venue_ptransport"></div>
    <div class="ms_venue_notes"></div>
  </div>
  <!-- Duplicate of first event (Makesweat renders events twice) -->
  <div class="ms_event makesweatevent-12345">
    <div class="ms_eventtitle">City Hash R*n #1912 International Women's Day @ The Old Star</div>
    <div class="ms_event_startdate">Tue 10th Mar 26</div>
    <div class="ms_eventstart">7:00pm</div>
    <div class="ms_eventdescription">Hare - Sort Yourself Out</div>
    <div class="ms_venue_name">The Old Star</div>
    <div class="ms_venue_address">66 Broadway</div>
    <div class="ms_venue_postcode">SW1H 0DB</div>
    <div class="ms_venue_ptransport">St James's Park</div>
    <div class="ms_venue_notes"></div>
  </div>
</div>
`;

describe("parseMakesweatEvent", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const cards = $(".ms_event");

  it("parses themed event with full venue data", () => {
    const event = parseMakesweatEvent($, cards.eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-10");
    expect(event!.kennelTags[0]).toBe("cityh3");
    expect(event!.runNumber).toBe(1912);
    expect(event!.title).toBe("City Hash Run #1912 - International Women's Day");
    expect(event!.hares).toBe("Sort Yourself Out");
    expect(event!.location).toBe("The Old Star, 66 Broadway, SW1H 0DB");
    expect(event!.startTime).toBe("19:00");
    expect(event!.description).toContain("Nearest station: St James's Park");
  });

  it("parses plain event without theme", () => {
    const event = parseMakesweatEvent($, cards.eq(1), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-24");
    expect(event!.runNumber).toBe(1914);
    expect(event!.title).toBe("City Hash Run #1914");
    expect(event!.hares).toBe("Zippy and Bungle");
    expect(event!.location).toBe("The Eagle, 2 Shepherdess Walk, N1 7LB");
    expect(event!.description).toContain("Nearest station: Old Street");
    expect(event!.description).toContain("Nearest Tube is Old Street, Northern Line");
  });

  it("skips TBA venue — location is undefined", () => {
    const event = parseMakesweatEvent($, cards.eq(2), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1915);
    expect(event!.location).toBeUndefined();
    expect(event!.hares).toBe("TBC");
  });

  it("skips TBC/TBD venue via isPlaceholder — location is undefined", () => {
    const tbcHtml = `<div class="ms_event">
      <div class="ms_eventtitle">City Hash R*n #1920 @ TBC</div>
      <div class="ms_event_startdate">Tue 5th May 26</div>
      <div class="ms_eventstart">7:00pm</div>
      <div class="ms_eventdescription"></div>
      <div class="ms_venue_name">TBC</div>
    </div>`;
    const $tbc = cheerio.load(tbcHtml);
    const event = parseMakesweatEvent($tbc, $tbc(".ms_event").eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
  });

  it("passes CTA hare text through verbatim (sanitizeHares clears it; #726, #949, #963)", () => {
    // Source description: "Hare Needed! Please contact Full Load" — the "Hare"
    // prefix with dash separator is how Makesweat formats the field. The
    // adapter no longer null-filters CTAs in-place — it passes raw text
    // through so the merge pipeline's sanitizeHares can recognize the CTA
    // and write `haresText: null`, which clears stale values on existing
    // canonical events. Returning undefined here would leave the merge
    // UPDATE branch as a no-op for hares, so a stale "69 Virgins to
    // Paradise" (#949) would persist forever.
    const ctaHtml = `<div class="ms_event makesweatevent-99999">
      <div class="ms_eventtitle">City Hash R*n #1920 @ TBA</div>
      <div class="ms_event_startdate">Tue 21st Apr 26</div>
      <div class="ms_eventstart">7:00pm</div>
      <div class="ms_eventdescription">Hare - Hare Needed! Please contact Full Load
Pub - TBA</div>
      <div class="ms_venue_name">TBA</div>
    </div>`;
    const $cta = cheerio.load(ctaHtml);
    const event = parseMakesweatEvent($cta, $cta(".ms_event").eq(0), "https://makesweat.com/cityhash#hashes");
    // Raw passthrough — sanitization happens downstream.
    expect(event?.hares).toBe("Hare Needed! Please contact Full Load");
  });

  it("passes 'We need a Hare, Contact Full Load!' through verbatim (#963)", () => {
    // Live #1920 reproduction (Makesweat 2026-04-26). Adapter must emit the
    // raw string so sanitizeHares can clear stale data on UPDATE.
    const ctaHtml = `<div class="ms_event makesweatevent-99999">
      <div class="ms_eventtitle">City Hash R*n #1920 @ TBA</div>
      <div class="ms_event_startdate">Tue 5th May 26</div>
      <div class="ms_eventstart">7:00pm</div>
      <div class="ms_eventdescription">Hare - We need a Hare, Contact Full Load!
Pub - TBA</div>
      <div class="ms_venue_name">TBA</div>
    </div>`;
    const $cta = cheerio.load(ctaHtml);
    const event = parseMakesweatEvent($cta, $cta(".ms_event").eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event?.hares).toBe("We need a Hare, Contact Full Load!");
  });

  it("does not collapse a matched-but-trim-empty hare value to undefined (#949)", () => {
    // Regression guard for the `|| undefined` footgun removed in this PR.
    // The merge UPDATE branch only writes `haresText` when
    // `event.hares !== undefined`. If the regex matches a label like
    // "Hare - " but `(.+?)` captures only whitespace-equivalent characters
    // that `trim()` strips, the adapter must still emit an empty string —
    // NOT `undefined` — so merge can call `sanitizeHares("")` (returns null)
    // and clear any stale value. Returning `undefined` would skip the write
    // entirely and "69 Virgins to Paradise" would persist forever (#949).
    //
    // We test the property by reading the source: the assignment is
    // `hares = hareMatch[1].trim();` — bare trim, no `|| undefined`.
    // This sentinel test fails if a future maintainer reintroduces the
    // collapse pattern.
    const src = readFileSync(
      new URL("./city-hash.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/hareMatch\[1\]\.trim\(\)\s*\|\|\s*undefined/);
  });

  it("extracts Makesweat ID from class attribute", () => {
    expect(extractMakesweatId(cards.eq(0))).toBe("12345");
  });

  it("includes Makesweat external link when ID is passed", () => {
    const event = parseMakesweatEvent($, cards.eq(0), "https://makesweat.com/cityhash#hashes", "12345");
    expect(event!.externalLinks).toEqual([
      { url: "https://makesweat.com/event.html?id=12345", label: "Makesweat" },
    ]);
  });

  it("parses start time from .ms_eventstart", () => {
    const event = parseMakesweatEvent($, cards.eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event!.startTime).toBe("19:00");
  });

  it("does not duplicate postcode when already in venue name", () => {
    const dupeHtml = `<div class="ms_event">
      <div class="ms_eventtitle">City Hash R*n #1930</div>
      <div class="ms_event_startdate">Tue 20th May 26</div>
      <div class="ms_eventstart">7:00pm</div>
      <div class="ms_eventdescription"></div>
      <div class="ms_venue_name">Old Star, London E8 2HG</div>
      <div class="ms_venue_address">66 Broadway</div>
      <div class="ms_venue_postcode">E8 2HG</div>
    </div>`;
    const $dupe = cheerio.load(dupeHtml);
    const event = parseMakesweatEvent($dupe, $dupe(".ms_event").eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    // Postcode should NOT appear twice
    expect(event!.location).toBe("Old Star, London E8 2HG, 66 Broadway");
    expect(event!.location).not.toContain("E8 2HG, E8 2HG");
  });

  it("normalizes postcode jammed against venue name", () => {
    // When the postcode is directly abutting the venue name (no space),
    // the jammed postcode regex detects and splits it correctly
    const html = `<div class="ms_event">
      <div class="ms_eventtitle">City Hash R*n #1914</div>
      <div class="ms_event_startdate">Mon 17th Mar 26</div>
      <div class="ms_eventstart">7:00pm</div>
      <div class="ms_eventdescription"></div>
      <div class="ms_venue_name">The Duke of EdinburghSW9 8AG</div>
      <div class="ms_venue_address">204 Ferndale Rd, Brixton, London</div>
      <div class="ms_venue_postcode">SW9 8AG</div>
    </div>`;
    const $jammed = cheerio.load(html);
    const event = parseMakesweatEvent($jammed, $jammed(".ms_event").eq(0), "https://makesweat.com/cityhash#hashes");
    expect(event).not.toBeNull();
    expect(event!.location).toBe("The Duke of Edinburgh, 204 Ferndale Rd, Brixton, London, SW9 8AG");
  });
});

describe("CityHashAdapter.fetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses sample HTML, deduplicates events, and returns results", async () => {
    mockedBrowserRender.mockResolvedValue(SAMPLE_HTML);

    const adapter = new CityHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://makesweat.com/cityhash#hashes",
    } as never);

    // 4 .ms_event elements, but one is a duplicate → 3 unique events
    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.diagnosticContext).toMatchObject({
      cardsFound: 4,
      eventsDeduped: 3,
      eventsParsed: 3,
    });
  });

  it("returns fetch error on browser render failure", async () => {
    mockedBrowserRender.mockRejectedValue(new Error("Browser render timeout"));

    const adapter = new CityHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://makesweat.com/cityhash#hashes",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
