import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEventsIndex,
  parseHashRegoDate,
  parseHashRegoTime,
  parseEventDetail,
  splitToRawEvents,
} from "./parser";
import { HashRegoAdapter } from "./adapter";

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

  it("handles 12:00 AM (midnight)", () => {
    expect(parseHashRegoTime("12:00 AM")).toBe("00:00");
  });

  it("returns null for 11:59 PM (Hash Rego placeholder for no time)", () => {
    expect(parseHashRegoTime("11:59 PM")).toBeNull();
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

describe("parseEventDetail", () => {
  const indexEntry = {
    slug: "bfmh3-agm-2026",
    kennelSlug: "BFMH3",
    title: "BFMH3 AGM 2026",
    startDate: "02/05/26",
    startTime: "07:00 PM",
    type: "Trail",
    cost: "$35",
  };

  it("extracts title from og:title", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.title).toBe("BFMH3 AGM 2026: The Dog Days Are Over");
  });

  it("extracts kennel slug from sidebar link", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.kennelSlug).toBe("BFMH3");
  });

  it("extracts hares", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.hares).toBe("BananAss");
  });

  it("extracts cost", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.cost).toBe("$35");
  });

  it("extracts location from Where field", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.location).toBe("Misconduct Tavern Rittenhouse");
  });

  it("detects single-day event", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
    expect(parsed.isMultiDay).toBe(false);
    expect(parsed.dates).toHaveLength(1);
    expect(parsed.dates[0]).toBe("2026-02-05");
  });

  it("cleans description by removing extracted fields", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", indexEntry);
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

describe("parseEventDetail (multi-day)", () => {
  const indexEntry = {
    slug: "anthrax-2025",
    kennelSlug: "CH3",
    title: "Anthrax of Horrors 2025",
    startDate: "12/12/25",
    startTime: "07:00 PM",
    type: "Hash Weekend",
    cost: "$119",
  };

  it("detects multi-day event from date range", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", indexEntry);
    expect(parsed.isMultiDay).toBe(true);
  });

  it("generates dates for each day in range", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", indexEntry);
    expect(parsed.dates).toHaveLength(3);
    expect(parsed.dates[0]).toBe("2025-12-12");
    expect(parsed.dates[1]).toBe("2025-12-13");
    expect(parsed.dates[2]).toBe("2025-12-14");
  });

  it("extracts kennel slug", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", indexEntry);
    expect(parsed.kennelSlug).toBe("CH3");
  });
});

// ── splitToRawEvents ──

describe("splitToRawEvents", () => {
  it("produces one event for single-day", () => {
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", {
      slug: "bfmh3-agm-2026",
      kennelSlug: "BFMH3",
      title: "BFMH3 AGM 2026",
      startDate: "02/05/26",
      startTime: "07:00 PM",
      type: "Trail",
      cost: "$35",
    });
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
    const parsed = parseEventDetail(SINGLE_DAY_HTML, "bfmh3-agm-2026", {
      slug: "bfmh3-agm-2026",
      kennelSlug: "BFMH3",
      title: "BFMH3 AGM 2026",
      startDate: "02/05/26",
      startTime: "07:00 PM",
      type: "Trail",
      cost: "$35",
    });
    const events = splitToRawEvents(parsed, "bfmh3-agm-2026");
    expect(events[0].seriesId).toBeUndefined();
  });

  it("produces multiple events for multi-day with seriesId", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", {
      slug: "anthrax-2025",
      kennelSlug: "CH3",
      title: "Anthrax of Horrors 2025",
      startDate: "12/12/25",
      startTime: "07:00 PM",
      type: "Hash Weekend",
      cost: "$119",
    });
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
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", {
      slug: "anthrax-2025",
      kennelSlug: "CH3",
      title: "Anthrax of Horrors 2025",
      startDate: "12/12/25",
      startTime: "07:00 PM",
      type: "Hash Weekend",
      cost: "$119",
    });
    const events = splitToRawEvents(parsed, "anthrax-2025");
    expect(events[0].title).toContain("(Day 1)");
    expect(events[1].title).toContain("(Day 2)");
    expect(events[2].title).toContain("(Day 3)");
  });

  it("all multi-day events share the same Hash Rego link", () => {
    const parsed = parseEventDetail(MULTI_DAY_HTML, "anthrax-2025", {
      slug: "anthrax-2025",
      kennelSlug: "CH3",
      title: "Anthrax of Horrors 2025",
      startDate: "12/12/25",
      startTime: "07:00 PM",
      type: "Hash Weekend",
      cost: "$119",
    });
    const events = splitToRawEvents(parsed, "anthrax-2025");
    for (const e of events) {
      expect(e.externalLinks).toEqual([
        { url: "https://hashrego.com/events/anthrax-2025", label: "Hash Rego" },
      ]);
    }
  });
});

// ── HashRegoAdapter.fetch ──

describe("HashRegoAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function buildSource(configOverrides?: { kennelSlugs?: string[] }) {
    return {
      id: "src1",
      name: "Hash Rego",
      url: "https://hashrego.com/events",
      type: "HASHREGO" as const,
      config: { kennelSlugs: configOverrides?.kennelSlugs ?? [] },
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

  it("returns empty events when no kennelSlugs configured", async () => {
    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("No kennelSlugs configured");
  });

  it("filters index entries by configured kennel slugs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Mock index page
    fetchSpy.mockResolvedValueOnce(
      new Response(INDEX_HTML, { status: 200 }),
    );
    // Mock detail page for EWH3 event
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource({ kennelSlugs: ["EWH3"] });

    const result = await adapter.fetch(source);

    // Should have fetched index + 1 detail page (only EWH3 matches)
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://hashrego.com/events");
    expect(fetchSpy.mock.calls[1][0]).toContain("ewh3-1506-revenge");
  });

  it("uses fallback when detail page fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Mock index page
    fetchSpy.mockResolvedValueOnce(
      new Response(INDEX_HTML, { status: 200 }),
    );
    // Mock detail page failure
    fetchSpy.mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource({ kennelSlugs: ["EWH3"] });

    const result = await adapter.fetch(source);

    // Should still produce an event from index data
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].kennelTag).toBe("EWH3");
    expect(result.events[0].date).toBe("2026-02-19");
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles case-insensitive kennel slug matching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(
      new Response(INDEX_HTML, { status: 200 }),
    );
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource({ kennelSlugs: ["ewh3"] }); // lowercase

    const result = await adapter.fetch(source);
    // Should have matched EWH3 despite lowercase config
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("includes diagnostic context", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(
      new Response(INDEX_HTML, { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource({ kennelSlugs: ["NONEXISTENT"] });

    const result = await adapter.fetch(source);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext?.totalIndexEntries).toBe(4);
    expect(result.diagnosticContext?.matchingEntries).toBe(0);
  });
});
