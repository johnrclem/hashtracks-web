import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEventsIndex,
  parseKennelEventsPage,
  parseHashRegoDate,
  parseHashRegoTime,
  parseEventDetail,
  splitToRawEvents,
} from "./parser";
import { HashRegoAdapter } from "./adapter";

vi.mock("@/lib/browser-render", () => ({
  browserRender: vi.fn(),
}));

import { browserRender } from "@/lib/browser-render";

// ── parseHashRegoDate ──

describe("parseHashRegoDate", () => {
  it("parses MM/DD/YY format", () => {
    expect(parseHashRegoDate("02/19/26")).toBe("2026-02-19");
  });

  it("parses MM/DD/YYYY format", () => {
    expect(parseHashRegoDate("12/25/2025")).toBe("2025-12-25");
  });

  it("parses MM/DD with reference year", () => {
    expect(parseHashRegoDate("02/19", 2026)).toBe("2026-02-19");
  });

  it("returns null for MM/DD without reference year", () => {
    expect(parseHashRegoDate("02/19")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(parseHashRegoDate("13/01/26")).toBeNull();
  });

  it("returns null for invalid day", () => {
    expect(parseHashRegoDate("02/32/26")).toBeNull();
  });

  it("returns null for gibberish", () => {
    expect(parseHashRegoDate("not a date")).toBeNull();
  });

  it("handles single-digit month and day", () => {
    expect(parseHashRegoDate("3/5/26")).toBe("2026-03-05");
  });
});

// ── parseHashRegoTime ──

describe("parseHashRegoTime", () => {
  it("converts PM time to 24h", () => {
    expect(parseHashRegoTime("07:00 PM")).toBe("19:00");
  });

  it("converts AM time", () => {
    expect(parseHashRegoTime("08:00 AM")).toBe("08:00");
  });

  it("handles 12:00 PM (noon)", () => {
    expect(parseHashRegoTime("12:00 PM")).toBe("12:00");
  });

  it("returns null for 11:59 PM (original Hash Rego placeholder)", () => {
    expect(parseHashRegoTime("11:59 PM")).toBeNull();
  });

  it("returns null for 11:45 PM (#487 EWH3 1355 variant)", () => {
    // Some kennels use 11:45 PM instead of 11:59 PM as their "no time set"
    // placeholder. Everything from 11 PM through 4 AM is now treated as
    // placeholder because real hash runs don't start in that window on
    // this platform.
    expect(parseHashRegoTime("11:45 PM")).toBeNull();
  });

  it("returns null for 11:00 PM (late-night band PM endpoint)", () => {
    expect(parseHashRegoTime("11:00 PM")).toBeNull();
  });

  it("returns null for 1:00 AM (mid-band AM time)", () => {
    expect(parseHashRegoTime("01:00 AM")).toBeNull();
  });

  it("returns null for 3:59 AM (late-night band AM endpoint)", () => {
    expect(parseHashRegoTime("03:59 AM")).toBeNull();
  });

  it("accepts 10:59 PM and 4:00 AM (just outside the placeholder band)", () => {
    expect(parseHashRegoTime("10:59 PM")).toBe("22:59");
    expect(parseHashRegoTime("04:00 AM")).toBe("04:00");
  });

  it("returns null for invalid time", () => {
    expect(parseHashRegoTime("not a time")).toBeNull();
  });

  it("handles lowercase am/pm", () => {
    expect(parseHashRegoTime("02:30 pm")).toBe("14:30");
  });
});

// ── parseEventsIndex ──

const INDEX_HTML = `
<html><body>
<table id="eventListTable" class="table table-striped tablesorter">
    <thead>
        <tr>
            <th>Event Name</th>
            <th>Type</th>
            <th>Host Kennel</th>
            <th>Start Date</th>
            <th>Cost</th>
            <th>Rego'd Hashers</th>
        </tr>
    </thead>
    <tbody>
        <tr>
            <td><a href="/events/ewh3-1506-revenge" name="lg-ewh3-1506-revenge">EWH3 #1506: Revenge</a></td>
            <td>Trail</td>
            <td><a href="/kennels/EWH3/">EWH3<br><i class="fa fa-globe"></i> DC</a></td>
            <td>02/19/26<br>07:00 PM</td>
            <td>$10</td>
            <td><a href="/events/ewh3-1506-revenge/cumming">7</a></td>
        </tr>
        <tr>
            <td><a href="/events/bfmh3-agm-2026" name="lg-bfmh3-agm-2026">BFMH3 AGM 2026</a></td>
            <td>Trail</td>
            <td><a href="/kennels/BFMH3/">BFMH3<br><i class="fa fa-globe"></i> PA</a></td>
            <td>02/05/26<br>07:00 PM</td>
            <td>$35</td>
            <td><a href="/events/bfmh3-agm-2026/cumming">32</a></td>
        </tr>
        <tr>
            <td><a href="/events/anthrax-2025" name="lg-anthrax-2025">Anthrax of Horrors 2025</a></td>
            <td>Hash Weekend</td>
            <td><a href="/kennels/CH3/">CH3<br><i class="fa fa-globe"></i> IL</a></td>
            <td>12/12/25<br>07:00 PM</td>
            <td>$119</td>
            <td><a href="/events/anthrax-2025/cumming">150</a>/200</td>
        </tr>
        <tr>
            <td><a href="/events/random-event" name="lg-random">Random Kennel Event</a></td>
            <td>Trail</td>
            <td><a href="/kennels/RANDOMH3/">RANDOMH3<br><i class="fa fa-globe"></i> NY</a></td>
            <td>03/01/26<br>11:59 PM</td>
            <td>$5</td>
            <td>0</td>
        </tr>
    </tbody>
</table>
</body></html>`;

describe("parseEventsIndex", () => {
  it("parses all rows from the table", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries).toHaveLength(4);
  });

  it("extracts event slug from href", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].slug).toBe("ewh3-1506-revenge");
  });

  it("extracts kennel slug from kennel link", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].kennelSlug).toBe("EWH3");
    expect(entries[1].kennelSlug).toBe("BFMH3");
  });

  it("extracts title text", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].title).toBe("EWH3 #1506: Revenge");
  });

  it("extracts start date", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].startDate).toBe("02/19/26");
  });

  it("extracts start time from date cell", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].startTime).toBe("07:00 PM");
  });

  it("extracts type", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].type).toBe("Trail");
    expect(entries[2].type).toBe("Hash Weekend");
  });

  it("extracts cost", () => {
    const entries = parseEventsIndex(INDEX_HTML);
    expect(entries[0].cost).toBe("$10");
    expect(entries[2].cost).toBe("$119");
  });
});

// ── parseKennelEventsPage ──

const KENNEL_PAGE_HTML = `
<html><body>
<table class="table table-striped ng-scope">
  <thead>
    <tr>
      <th>Start Date</th>
      <th>Type</th>
      <th>Event Name</th>
      <th>Cost</th>
      <th>Cumming</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td class="ng-binding">06/27 4:30 PM</td>
      <td class="text-center ng-binding"></td>
      <td class="text-center"><a href="//hashrego.com/events/nych3-5-boro-pub-crawl-2026" class="ng-binding">5-boro Pub Crawl</a></td>
      <td class="text-center ng-binding">$0</td>
      <td class="text-center"><a href="//hashrego.com/events/nych3-5-boro-pub-crawl-2026/cumming" class="ng-binding">1</a></td>
    </tr>
    <tr>
      <td class="ng-binding">09/15 07:00 PM</td>
      <td class="text-center ng-binding">Trail</td>
      <td class="text-center"><a href="//hashrego.com/events/nych3-run-42" class="ng-binding">NYCH3 Run #42</a></td>
      <td class="text-center ng-binding">$10</td>
      <td class="text-center"><a href="//hashrego.com/events/nych3-run-42/cumming" class="ng-binding">5</a></td>
    </tr>
  </tbody>
</table>
</body></html>`;

describe("parseKennelEventsPage", () => {
  it("parses all rows from kennel events table", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "NYCH3", 2026);
    expect(entries).toHaveLength(2);
  });

  it("extracts event slug from href", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "NYCH3", 2026);
    expect(entries[0].slug).toBe("nych3-5-boro-pub-crawl-2026");
  });

  it("sets kennelSlug from function parameter", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "nych3", 2026);
    expect(entries[0].kennelSlug).toBe("NYCH3"); // uppercased
  });

  it("extracts date with reference year appended", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "NYCH3", 2026);
    expect(entries[0].startDate).toBe("06/27/26");
  });

  it("extracts time from date cell", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "NYCH3", 2026);
    expect(entries[0].startTime).toBe("4:30 PM");
  });

  it("extracts type and cost", () => {
    const entries = parseKennelEventsPage(KENNEL_PAGE_HTML, "NYCH3", 2026);
    expect(entries[0].type).toBe(""); // empty on live site for this event
    expect(entries[0].cost).toBe("$0");
    expect(entries[1].type).toBe("Trail");
    expect(entries[1].cost).toBe("$10");
  });

  it("returns empty array for empty table", () => {
    const html = `<html><body><table class="table table-striped"><thead><tr><th>Start Date</th></tr></thead><tbody></tbody></table></body></html>`;
    expect(parseKennelEventsPage(html, "NYCH3", 2026)).toHaveLength(0);
  });

  it("skips rows without event links", () => {
    const html = `<html><body><table class="table table-striped"><thead><tr><th>Start Date</th></tr></thead><tbody>
      <tr><td>06/27</td><td>Trail</td><td>No link here</td><td>$0</td><td>0</td></tr>
    </tbody></table></body></html>`;
    expect(parseKennelEventsPage(html, "NYCH3", 2026)).toHaveLength(0);
  });

  it("infers next year for Jan events when scraping in December", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    const html = `<html><body><table class="table table-striped ng-scope">
      <thead><tr><th>Start Date</th><th>Type</th><th>Event Name</th><th>Cost</th><th>Cumming</th></tr></thead>
      <tbody><tr>
        <td>01/10 07:00 PM</td><td>Trail</td>
        <td><a href="//hashrego.com/events/test-jan">Jan Event</a></td><td>$5</td><td>0</td>
      </tr></tbody></table></body></html>`;
    const entries = parseKennelEventsPage(html, "TEST");
    expect(entries[0].startDate).toBe("01/10/27");
    vi.useRealTimers();
  });

  it("infers previous year for Dec events when scraping in January", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-01-05T12:00:00Z"));
    const html = `<html><body><table class="table table-striped ng-scope">
      <thead><tr><th>Start Date</th><th>Type</th><th>Event Name</th><th>Cost</th><th>Cumming</th></tr></thead>
      <tbody><tr>
        <td>12/28 07:00 PM</td><td>Trail</td>
        <td><a href="//hashrego.com/events/test-dec">Dec Event</a></td><td>$5</td><td>0</td>
      </tr></tbody></table></body></html>`;
    const entries = parseKennelEventsPage(html, "TEST");
    expect(entries[0].startDate).toBe("12/28/26");
    vi.useRealTimers();
  });
});

// ── parseEventDetail ──

const SINGLE_DAY_HTML = `
<html>
<head>
  <title>BFMH3 AGM 2026: The Dog Days Are Over</title>
  <meta property="og:title" content="02/05 BFMH3 AGM 2026: The Dog Days Are Over" />
  <meta property="og:description" content='Prelube: Misconduct Tavern

"Every dog needs to be put down eventually"

**When:** 6:45 PM Thursday, February 5, 2026. Pack away at 7:15 PM!

**Where:** Misconduct Tavern Rittenhouse

**Hare(s):** BananAss

**Cost:** $35

Trail details and more info here.
Join us for a great time.' />
</head>
<body>
  <a href="/kennels/BFMH3/">BFMH3</a>
</body>
</html>`;

const BFMH3_INDEX_ENTRY = {
  slug: "bfmh3-agm-2026",
  kennelSlug: "BFMH3",
  title: "BFMH3 AGM 2026",
  startDate: "02/05/26",
  startTime: "07:00 PM",
  type: "Trail",
  cost: "$35",
};

describe("parseEventDetail", () => {
  it("extracts title from og:title", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.title).toBe("BFMH3 AGM 2026: The Dog Days Are Over");
  });

  it("extracts kennel slug from sidebar link", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.kennelSlug).toBe("BFMH3");
  });

  it("extracts hares", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.hares).toBe("BananAss");
  });

  it("extracts cost", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.cost).toBe("$35");
  });

  it("extracts location from Where field", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.location).toBe("Misconduct Tavern Rittenhouse");
  });

  it("detects single-day event", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.isMultiDay).toBe(false);
    expect(parsed.dates).toHaveLength(1);
    expect(parsed.dates[0]).toBe("2026-02-05");
  });

  it("cleans description by removing extracted fields", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    expect(parsed.description).toBeDefined();
    // Should not contain the extracted field lines
    expect(parsed.description).not.toContain("**Hare(s):**");
    expect(parsed.description).not.toContain("**Cost:**");
    // Should contain the narrative text
    expect(parsed.description).toContain("Every dog needs to be put down eventually");
  });
});

// ── Multi-day event ──

const MULTI_DAY_HTML = `
<html>
<head>
  <title>Anthrax of Horrors 2025</title>
  <meta property="og:title" content="12/12 Anthrax of Horrors 2025" />
  <meta property="og:description" content='12/12 07:00 PM to 12/14 05:00 PM
A Hash Weekend

3 days of runs, drinking, and horror!

Prelube: Friday, December 12th - 7:00 show, 7:30 go
Location: Cody&apos;s Public House, 1658 W Barry Ave, Chicago, IL 60657

Main Event! Saturday, December 13th
Theme: Horror Movie Hash
Location: Revolution Brewery

Hangover Trail: Sunday, December 14th - 1:00 show, 1:30 go
Location: Holiday Club

**Hares:** Various hares each day

**Cost:** $119' />
</head>
<body>
  <a href="/kennels/CH3/">Chicago H3</a>
</body>
</html>`;

const ANTHRAX_INDEX_ENTRY = {
  slug: "anthrax-2025",
  kennelSlug: "CH3",
  title: "Anthrax of Horrors 2025",
  startDate: "12/12/25",
  startTime: "07:00 PM",
  type: "Hash Weekend",
  cost: "$119",
};

describe("parseEventDetail (multi-day)", () => {
  it("detects multi-day event from date range", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    expect(parsed.isMultiDay).toBe(true);
  });

  it("generates dates for each day in range", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    expect(parsed.dates).toHaveLength(3);
    expect(parsed.dates[0]).toBe("2025-12-12");
    expect(parsed.dates[1]).toBe("2025-12-13");
    expect(parsed.dates[2]).toBe("2025-12-14");
  });

  it("extracts kennel slug", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    expect(parsed.kennelSlug).toBe("CH3");
  });
});

// ── splitToRawEvents ──

describe("splitToRawEvents", () => {
  it("produces one event for single-day", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    const events = splitToRawEvents(parsed, "bfmh3-agm-2026");
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-02-05");
    expect(events[0].kennelTag).toBe("BFMH3");
    expect(events[0].sourceUrl).toBe("https://hashrego.com/events/bfmh3-agm-2026");
    expect(events[0].externalLinks).toEqual([
      { url: "https://hashrego.com/events/bfmh3-agm-2026", label: "Hash Rego" },
    ]);
  });

  it("does not set seriesId for single-day events", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", BFMH3_INDEX_ENTRY);
    const events = splitToRawEvents(parsed, "bfmh3-agm-2026");
    expect(events[0].seriesId).toBeUndefined();
  });

  it("produces multiple events for multi-day with seriesId", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    const events = splitToRawEvents(parsed, "anthrax-2025");
    expect(events).toHaveLength(3);
    expect(events[0].date).toBe("2025-12-12");
    expect(events[1].date).toBe("2025-12-13");
    expect(events[2].date).toBe("2025-12-14");

    // All share the same seriesId
    expect(events[0].seriesId).toBe("anthrax-2025");
    expect(events[1].seriesId).toBe("anthrax-2025");
    expect(events[2].seriesId).toBe("anthrax-2025");
  });

  it("adds day labels to multi-day event titles", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    const events = splitToRawEvents(parsed, "anthrax-2025");
    expect(events[0].title).toContain("(Day 1)");
    expect(events[1].title).toContain("(Day 2)");
    expect(events[2].title).toContain("(Day 3)");
  });

  it("all multi-day events share the same Hash Rego link", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", ANTHRAX_INDEX_ENTRY);
    const events = splitToRawEvents(parsed, "anthrax-2025");
    for (const e of events) {
      expect(e.externalLinks).toEqual([
        { url: "https://hashrego.com/events/anthrax-2025", label: "Hash Rego" },
      ]);
    }
  });
});

// ── HashRegoAdapter.fetch ──

function buildSource(configOverrides?: { kennelSlugs?: string[] }) {
  return {
    id: "src1",
    name: "Hash Rego",
    url: "https://hashrego.com/events",
    type: "HASHREGO" as const,
    config: configOverrides ? { kennelSlugs: configOverrides.kennelSlugs ?? [] } : null,
    trustLevel: 8,
    scrapeFreq: "daily",
    lastScrapeAt: null,
    lastSuccessAt: null,
    healthStatus: "UNKNOWN" as const,
    scrapeDays: 90,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("HashRegoAdapter", () => {
  const savedProxyUrl = process.env.RESIDENTIAL_PROXY_URL;
  const savedProxyKey = process.env.RESIDENTIAL_PROXY_KEY;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(browserRender).mockReset();
    // Ensure tests use direct fetch path regardless of env
    delete process.env.RESIDENTIAL_PROXY_URL;
    delete process.env.RESIDENTIAL_PROXY_KEY;
    // Freeze time to before all fixture dates so they fall within the forward window
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (savedProxyUrl !== undefined) process.env.RESIDENTIAL_PROXY_URL = savedProxyUrl;
    if (savedProxyKey !== undefined) process.env.RESIDENTIAL_PROXY_KEY = savedProxyKey;
  });

  it("returns empty events when no kennelSlugs provided", async () => {
    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { kennelSlugs: [] });
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("No kennel slugs provided");
  });

  it("uses options.kennelSlugs to filter events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0]).toContain("ewh3-1506-revenge");
    expect(result.diagnosticContext?.kennelSlugsConfigured).toEqual(["EWH3"]);
  });

  it("filters index entries by kennel slugs via options", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Should have fetched index + 1 detail page (only EWH3 matches)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://hashrego.com/events");
    expect(fetchSpy.mock.calls[1][0]).toContain("ewh3-1506-revenge");
  });

  it("uses fallback when detail page fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].kennelTag).toBe("EWH3");
    expect(result.events[0].date).toBe("2026-02-19");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles case-insensitive kennel slug matching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    await adapter.fetch(source, { days: 36500, kennelSlugs: ["ewh3"] }); // lowercase

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("includes diagnostic context with slug source", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // NONEXISTENT is not in global index — browserRender will be called for kennel page
    vi.mocked(browserRender).mockRejectedValueOnce(new Error("not found"));

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { kennelSlugs: ["NONEXISTENT"] });

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext?.totalIndexEntries).toBe(4);
    expect(result.diagnosticContext?.matchingEntries).toBe(0);
    expect(result.diagnosticContext?.kennelSlugsConfigured).toEqual(["NONEXISTENT"]);
  });

  it("fetches kennel page when slug has zero global index matches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Set time so kennel page dates (06/27/26) fall within window
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));

    const detailHtml = `<html><head>
      <meta property="og:title" content="06/27 5-boro Pub Crawl" />
      <meta property="og:description" content="A fun event" />
    </head><body><a href="/kennels/NYCH3/">NYCH3</a></body></html>`;

    // Global index (no NYCH3)
    fetchSpy.mockImplementation(async () => new Response(detailHtml, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));

    // browserRender returns the kennel page HTML
    vi.mocked(browserRender).mockResolvedValueOnce(KENNEL_PAGE_HTML);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    expect(browserRender).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://hashrego.com/kennels/NYCH3/events" }),
    );
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["NYCH3"]);
    expect((result.diagnosticContext?.kennelPageEventsFound as number)).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("skips kennel page when slug has global index matches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // EWH3 has a match in global index — should go straight to detail page
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Should NOT have called browserRender (slug is in global index)
    expect(browserRender).not.toHaveBeenCalled();
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual([]);
  });

  it("handles kennel page render failure gracefully", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    vi.mocked(browserRender).mockRejectedValueOnce(new Error("Render timeout"));

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["NYCH3"]);
    expect(result.diagnosticContext?.kennelPageEventsFound).toBe(0);
    expect(result.events).toHaveLength(0);
    // Step 2b errors are non-fatal — tracked in errorDetails, not errors[]
    expect(result.errors).toHaveLength(0);
    expect(result.errorDetails?.fetch).toBeDefined();
    expect(result.errorDetails!.fetch![0].message).toContain("Kennel page error");
  });

  it("continues past 502 render errors to reach pages with events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // Detail page for any events found via kennel pages
    fetchSpy.mockImplementation(async () => new Response("<html></html>", { status: 200 }));

    // First slug: 502 (empty kennel page timeout), second: success with events
    vi.mocked(browserRender)
      .mockRejectedValueOnce(new Error("Browser render error (502): Render failed"))
      .mockResolvedValueOnce(KENNEL_PAGE_HTML);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 365, kennelSlugs: ["MISS1", "NYCH3"] });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    // Should have checked both slugs — 502s are non-fatal
    expect(browserRender).toHaveBeenCalledTimes(2);
    expect(result.errors).toHaveLength(0);
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["MISS1", "NYCH3"]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
    expect((result.diagnosticContext?.kennelPageEventsFound as number)).toBeGreaterThan(0);
  });

  it("filters events by days window", async () => {
    vi.setSystemTime(new Date("2026-02-15T12:00:00Z"));

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }))
      // Detail page fetch for the 1 matching entry (EWH3)
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));
    // No kennel page fallback needed: all 4 slugs appear in global index (just outside date window)

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    // days=10 → lookback 7 days (Feb 8), cutoff +10 days (Feb 25)
    // EWH3 02/19/26 ✓ (within window), BFMH3 02/05/26 ✗ (before Feb 8 lookback)
    // CH3 12/12/25 ✗ (way before), RANDOMH3 03/01/26 ✗ (after Feb 25)
    const result = await adapter.fetch(source, { days: 10, kennelSlugs: ["EWH3", "BFMH3", "CH3", "RANDOMH3"] });

    // matchingEntries: 1 from global (EWH3) — no kennel page fallback since all slugs exist in index
    expect(result.diagnosticContext?.matchingEntries).toBe(1);
    expect(browserRender).not.toHaveBeenCalled();
  });

  it("retries index fetch on transient 500 then succeeds", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // First call: 500, second: 200 (index), third: 200 (detail page for EWH3)
    fetchSpy
      .mockResolvedValueOnce(new Response("Server Error", { status: 500 }))
      .mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
      );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Advance timers to process the 1s retry delay + any batch delays
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.events.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("returns error after all index fetch retries fail", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // All 3 attempts return 500
    fetchSpy
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Error", { status: 500 }))
      .mockResolvedValueOnce(new Response("Error", { status: 500 }));

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Advance past all retry delays (1s + 2s)
    await vi.advanceTimersByTimeAsync(5000);

    const result = await promise;
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("HTTP 500");
    expect(result.errors[0]).toContain("after 3 attempts");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("caps kennel page fetches at MAX_KENNEL_PAGES", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));

    // Provide 15 missing slugs (not in the global index) — only 10 should be checked
    const missingSlugs = Array.from({ length: 15 }, (_, i) => `MISS${i}`);
    vi.mocked(browserRender).mockRejectedValue(new Error("timeout"));

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 365, kennelSlugs: missingSlugs });

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await promise;
    // Should have checked at most 10 kennel pages (MAX_KENNEL_PAGES)
    expect(result.diagnosticContext?.kennelPagesChecked).toHaveLength(10);
    expect(result.diagnosticContext?.kennelPagesSkipped).toBe(5);
    expect(browserRender).toHaveBeenCalledTimes(10);
  });

  it("falls back to direct fetch when proxy env vars not set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
      );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Without RESIDENTIAL_PROXY_URL/KEY, safeFetch falls back to direct fetch
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses realistic User-Agent header", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy
      .mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
      );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Both calls should have a Chrome-like UA, not the old bot-identifying one
    for (const call of fetchSpy.mock.calls) {
      const init = call[1] as RequestInit | undefined;
      const headers = init?.headers as Record<string, string> | undefined;
      const ua = headers?.["User-Agent"] ?? "";
      expect(ua).not.toContain("HashTracks-Scraper");
      expect(ua).toContain("Chrome");
    }
  });
});
