import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  parseJEMEvent,
  parseJEMEventList,
  stripHareSuffix,
  FrankfurtHashAdapter,
} from "./frankfurt-hash";
import * as cheerio from "cheerio";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-frankfurt"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-frankfurt",
    name: "Frankfurt H3 Hareline",
    url: "https://frankfurt-hash.de/index.php/coming-runs/category/3:next-fh3-run",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "weekly",
    scrapeDays: 365,
    config: {
      archiveUrl: "https://frankfurt-hash.de/index.php/coming-runs/category/3?id=3&task=archive&filter_reset=1&limit=0",
      kennelPatterns: [
        ["SHITS|Shits", "SHITS"],
        ["^FM\\b|Full Moon|Frankfurt Full Moon", "FFMH3"],
        ["^DOM Run", "DOM"],
        ["Bike Hash|Bike Bash", "Bike Hash"],
      ],
      defaultKennelTag: "FH3",
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

function _mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers(),
  } as Response);
}

// ── Inline HTML fixtures ──

const UPCOMING_HTML = `<html><body>
<ul class="eventlist">
  <li class="jem-event jem-list-odd">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-03-29T14:30"></time>
      <time itemprop="endDate" content="2026-03-29T20:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1234:fh3-run-2114">Frankfurt Hash House Harriers #2114</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/123">Golfclub Rheinblick</a></div>
  </li>
  <li class="jem-event jem-list-even">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-04-12T19:00"></time>
      <time itemprop="endDate" content="2026-04-12T23:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1235:fm-frankfurt-full-moon">FM Frankfurt Full Moon Hash</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/456">Sachsenh&auml;user Warte</a></div>
  </li>
  <li class="jem-event jem-list-odd">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-05-01T15:00"></time>
      <time itemprop="endDate" content="2026-05-01T20:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1236:shits-run">SHITS Special Run</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/789">Alte Oper</a></div>
  </li>
  <li class="jem-event jem-list-even">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-06-15T16:00"></time>
      <time itemprop="endDate" content="2026-06-15T21:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1237:dom-run-42">DOM Run #42</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/321">R&ouml;merberg</a></div>
  </li>
  <li class="jem-event jem-list-odd">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-07-04T14:00"></time>
      <time itemprop="endDate" content="2026-07-04T19:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1238:bike-hash-5">Bike Hash Along the Main</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/654">Eiserner Steg</a></div>
  </li>
</ul>
</body></html>`;

const ARCHIVE_HTML = `<html><body>
<ul class="eventlist">
  <li class="jem-event jem-list-odd">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2008-07-12T16:00"></time>
      <time itemprop="endDate" content="2008-07-12T20:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1:fh3-run-1">Frankfurt Hash House Harriers Run 1</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/1">Palmengarten</a></div>
  </li>
  <li class="jem-event jem-list-even">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2026-03-29T14:30"></time>
      <time itemprop="endDate" content="2026-03-29T20:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/1234:fh3-run-2114">Frankfurt Hash House Harriers #2114</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/123">Golfclub Rheinblick</a></div>
  </li>
  <li class="jem-event jem-list-odd">
    <div class="jem-event-date">
      <time itemprop="startDate" content="2024-11-15T18:30"></time>
      <time itemprop="endDate" content="2024-11-15T23:00"></time>
    </div>
    <div class="jem-event-title"><h4><a href="/coming-runs/event/999:bike-bash-2">Bike Bash Frankfurt #2</a></h4></div>
    <div class="jem-event-venue"><a href="/venues/555">Mainufer</a></div>
  </li>
</ul>
</body></html>`;

// ── stripHareSuffix tests ──

describe("stripHareSuffix (#961)", () => {
  it("strips trailing ' Hare: <name>' from FH3-style titles", () => {
    // Live FH3 list-page title (2026-04-25) — hare name appended after run #
    expect(stripHareSuffix("FH3 Run #2119 Hare: Whore Durve")).toBe("FH3 Run #2119");
  });

  it("strips trailing ' Hares: <names>' (plural)", () => {
    expect(stripHareSuffix("FH3 Run #2120 Hares: Foo, Bar")).toBe("FH3 Run #2120");
  });

  it("is case-insensitive on the Hare(s) keyword", () => {
    expect(stripHareSuffix("FH3 Run #2121 hare: alice")).toBe("FH3 Run #2121");
    expect(stripHareSuffix("FH3 Run #2122 HARES: bob")).toBe("FH3 Run #2122");
  });

  it("passes through titles with no Hare suffix unchanged", () => {
    expect(stripHareSuffix("Frankfurt Hash House Harriers #2114")).toBe("Frankfurt Hash House Harriers #2114");
    expect(stripHareSuffix("FM Run 500 Full Moon Edition")).toBe("FM Run 500 Full Moon Edition");
  });

  it("returns the original title when stripping would empty it (defensive)", () => {
    // A malformed title that's *only* "Hare: X" should not collapse to "" —
    // RawEventData.title is required to be present for the merge to succeed.
    expect(stripHareSuffix("Hare: Solo")).toBe("Hare: Solo");
  });

  it("does not strip 'Hare' when not preceded by whitespace (no-op safety)", () => {
    // "FH3-Hare: X" (no whitespace before Hare) should not match. Catches
    // accidental over-eager regexes if someone tightens the pattern later.
    expect(stripHareSuffix("FH3-Hare: X")).toBe("FH3-Hare: X");
  });

  it("strips trailing ' Hare - <name>' (dash separator, archive form)", () => {
    // Live FH3 archive title (e.g. "FH3 Run #1639: Hare - Wankula") — the
    // run-# colon is left intact, only the trailing "Hare - …" is removed.
    expect(stripHareSuffix("FH3 Run #1639: Hare - Wankula")).toBe("FH3 Run #1639:");
    expect(stripHareSuffix("FH3 Run #1636: Hare - The Blacks")).toBe("FH3 Run #1636:");
  });
});

// ── parseJEMEvent tests ──

describe("parseJEMEvent", () => {
  const compiled: [RegExp, string][] = [
    [/SHITS|Shits/i, "SHITS"],
    [/(?:^FM\b)|Full Moon|Frankfurt Full Moon/i, "FFMH3"],
    [/^DOM Run/i, "DOM"],
    [/Bike Hash|Bike Bash/i, "Bike Hash"],
  ];
  const defaultTag = "FH3";
  const baseUrl = "https://frankfurt-hash.de";

  it("parses a standard FH3 event with date, time, title, venue, run number", () => {
    const html = `<li class="jem-event jem-list-odd">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-03-29T14:30"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/coming-runs/event/1234:fh3-run-2114">Frankfurt Hash House Harriers #2114</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/123">Golfclub Rheinblick</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-29");
    expect(event!.startTime).toBe("14:30");
    expect(event!.title).toBe("Frankfurt Hash House Harriers #2114");
    expect(event!.location).toBe("Golfclub Rheinblick");
    expect(event!.runNumber).toBe(2114);
    expect(event!.kennelTags[0]).toBe("FH3"); // default, no pattern match
    expect(event!.sourceUrl).toBe("https://frankfurt-hash.de/coming-runs/event/1234:fh3-run-2114");
  });

  it("extracts hares from inline 'Hares: …' text in the <li> (#466)", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-04-06T14:30"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1310:fh3-2116">Frankfurt Hash # 2116 — Easter Monday</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/9">Some Venue</a></div>
      <div class="jem-event-description">Hares: DOMs. Meet at the venue.</div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();
    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);
    expect(event!.hares).toBe("DOMs");
  });

  it("stops hare extraction at block-level paragraph boundaries (#550)", () => {
    // FFMH3 Run #16 (Frankfurt Full Moon Hash) had `<h3>HARE: Cummical Nerd</h3>`
    // followed by a separate `<p>Not exactely full moon… celebrate Cummical
    // Nerd's birthday!</p>`. Cheerio's .text() flattened both into one line, and
    // the old regex (which only stopped at `.`, `|`, or `by`) captured the
    // description as part of the hare name. Passing the raw HTML preserves the
    // block-level boundary as a newline, which the regex's `\n` stop respects.
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-04-10T19:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1312:frankfurt-full-moon-hash-re-reloaded-16">FFMH3 Run #16</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/11">Venue</a></div>
      <div class="jem-event-description">
        <h3>HARE: Cummical Nerd</h3>
        <p>Not exactely full moon but we will still celebrate Cummical Nerd's birthday!</p>
      </div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();
    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);
    expect(event!.hares).toBe("Cummical Nerd");
  });

  it("returns hares=undefined when no Hares: line is present", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-04-06T14:30"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1311">FH3 Run</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/10">Venue</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();
    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);
    expect(event!.hares).toBeUndefined();
  });

  it("matches FFMH3 pattern for Full Moon events", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-04-12T19:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1235">FM Frankfurt Full Moon Hash</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/456">Sachsenh\u00e4user Warte</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("FFMH3");
    expect(event!.startTime).toBe("19:00");
  });

  it("matches SHITS pattern", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-05-01T15:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1236">SHITS Special Run</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/789">Alte Oper</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("SHITS");
  });

  it("matches DOM pattern for DOM Run events", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-06-15T16:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1237">DOM Run #42</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/321">R\u00f6merberg</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("DOM");
    expect(event!.runNumber).toBe(42);
  });

  it("matches Bike Hash pattern", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-07-04T14:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1238">Bike Hash Along the Main</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/654">Eiserner Steg</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.kennelTags[0]).toBe("Bike Hash");
  });

  it("extracts 'Run NNN' style run numbers", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2008-07-12T16:00"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1">Frankfurt Hash House Harriers Run 1</a></h4></div>
      <div class="jem-event-venue"><a href="/venues/1">Palmengarten</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1);
  });

  it("returns null when startDate is missing", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date"></div>
      <div class="jem-event-title"><h4><a href="/event/1">Some Run</a></h4></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);
    expect(event).toBeNull();
  });

  it("returns null when title is empty", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-03-29T14:30"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1"></a></h4></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);
    expect(event).toBeNull();
  });

  it("handles missing venue gracefully", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-03-29T14:30"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1">FH3 Run #500</a></h4></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
  });

  it("handles date-only ISO (no time part)", () => {
    const html = `<li class="jem-event">
      <div class="jem-event-date">
        <time itemprop="startDate" content="2026-03-29"></time>
      </div>
      <div class="jem-event-title"><h4><a href="/event/1">FH3 Run</a></h4></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-29");
    expect(event!.startTime).toBeUndefined();
  });

  it("strips ' Hare: <name>' suffix from title and still extracts hares from the same <li> (#961)", () => {
    // Live-page-shaped HTML for FH3 Run #2119: title text contains the hare
    // name appended after the run number. extractHaresFromText() picks up the
    // "Hare:" pattern from the same <li> HTML, so stripping the title doesn't
    // lose the hare.
    const html = `<li class="jem-event">
      <time itemprop="startDate" content="2026-04-26T14:30"></time>
      <div class="jem-event-title">
        <h4 title="Title: FH3 Run #2119 Hare: Whore Durve">
          <a href="/index.php/coming-runs/event/1315:fh3-run-2119-hare-whore-durve">FH3 Run #2119 Hare: Whore Durve</a>
        </h4>
      </div>
      <div class="jem-event-venue"><a href="/venues/123">Flörsheim Bahnhof</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.title).toBe("FH3 Run #2119");
    expect(event!.runNumber).toBe(2119);
    expect(event!.hares).toBe("Whore Durve");
    expect(event!.kennelTags[0]).toBe("FH3");
  });

  it("strips ' Hare - <name>' suffix and extracts hares (archive dash form, #961)", () => {
    // Live FH3 archive entry: "FH3 Run #1639: Hare - Wankula" — both
    // stripHareSuffix and extractHaresFromText must accept the dash form,
    // otherwise the title strips but the hare is lost.
    const html = `<li class="jem-event">
      <time itemprop="startDate" content="2018-06-15T19:00"></time>
      <div class="jem-event-title">
        <h4 title="Title: FH3 Run #1639: Hare - Wankula">
          <a href="/index.php/coming-runs/event/695:Hare%20-%20Wankula">FH3 Run #1639: Hare - Wankula</a>
        </h4>
      </div>
      <div class="jem-event-venue"><a href="/venues/1">Frankfurt</a></div>
    </li>`;
    const $ = cheerio.load(html);
    const $li = $("li.jem-event").first();

    const event = parseJEMEvent($li, $, compiled, defaultTag, baseUrl);

    expect(event).not.toBeNull();
    expect(event!.title).toBe("FH3 Run #1639:");
    expect(event!.runNumber).toBe(1639);
    expect(event!.hares).toBe("Wankula");
  });
});

// ── parseJEMEventList tests ──

describe("parseJEMEventList", () => {
  const compiled: [RegExp, string][] = [
    [/SHITS|Shits/i, "SHITS"],
    [/(?:^FM\b)|Full Moon|Frankfurt Full Moon/i, "FFMH3"],
    [/^DOM Run/i, "DOM"],
    [/Bike Hash|Bike Bash/i, "Bike Hash"],
  ];

  it("parses multiple events from a full page", () => {
    const events = parseJEMEventList(UPCOMING_HTML, compiled, "FH3", "https://frankfurt-hash.de");

    expect(events).toHaveLength(5);
    expect(events[0].kennelTags[0]).toBe("FH3");
    expect(events[1].kennelTags[0]).toBe("FFMH3");
    expect(events[2].kennelTags[0]).toBe("SHITS");
    expect(events[3].kennelTags[0]).toBe("DOM");
    expect(events[4].kennelTags[0]).toBe("Bike Hash");
  });

  it("extracts venues correctly including HTML entities", () => {
    const events = parseJEMEventList(UPCOMING_HTML, compiled, "FH3", "https://frankfurt-hash.de");

    expect(events[0].location).toBe("Golfclub Rheinblick");
    expect(events[1].location).toBe("Sachsenhäuser Warte");
    expect(events[3].location).toBe("Römerberg");
  });

  it("returns empty array for HTML with no events", () => {
    const events = parseJEMEventList("<html><body>No events</body></html>", compiled, "FH3", "https://frankfurt-hash.de");
    expect(events).toHaveLength(0);
  });
});

// ── FrankfurtHashAdapter integration tests ──

describe("FrankfurtHashAdapter", () => {
  beforeEach(() => {
    mockedSafeFetch.mockReset();
  });

  it("fetches upcoming + archive, deduplicates, and filters by date window", async () => {
    const adapter = new FrankfurtHashAdapter();
    const source = makeSource();

    // First call = upcoming page, second call = archive page
    mockedSafeFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(UPCOMING_HTML),
        headers: new Headers(),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        text: () => Promise.resolve(ARCHIVE_HTML),
        headers: new Headers(),
      } as Response);

    const result = await adapter.fetch(source, { days: 365 });

    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBe("mock-hash-frankfurt");

    // Upcoming has 5, archive has 3 but one is a dup of upcoming (#2114)
    // After dedup: 5 + 2 = 7 total (before date window filtering)
    // The 2008 event and 2024 event are outside the ±365 day window from today
    const ctx = result.diagnosticContext as Record<string, unknown>;
    expect(ctx.upcomingEventsParsed).toBe(5);
    expect(ctx.archiveEventsParsed).toBe(3);
    expect(ctx.archiveDeduped).toBe(1); // The #2114 duplicate was removed
  });

  it("handles fetch errors gracefully", async () => {
    const adapter = new FrankfurtHashAdapter();
    const source = makeSource();

    mockedSafeFetch.mockRejectedValue(new Error("Network error"));

    const result = await adapter.fetch(source, { days: 90 });

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("throws on missing config", async () => {
    const adapter = new FrankfurtHashAdapter();
    const source = makeSource({ config: null });

    await expect(adapter.fetch(source)).rejects.toThrow("source.config is null");
  });

  it("throws on missing kennelPatterns", async () => {
    const adapter = new FrankfurtHashAdapter();
    const source = makeSource({ config: { defaultKennelTag: "FH3", archiveUrl: "https://example.com" } });

    await expect(adapter.fetch(source)).rejects.toThrow("kennelPatterns");
  });
});
