import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEventsIndex,
  parseKennelEventsPage,
  parseHashRegoDate,
  parseHashRegoTime,
  parseEventDetail,
  splitToRawEvents,
} from "./parser";
import { HashRegoAdapter, apiToIndexEntry } from "./adapter";
import { HashRegoApiError, type HashRegoKennelEvent } from "./api";
import ewh3Fixture from "./__fixtures__/api/kennel-ewh3-events.json";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    fetchKennelEvents: vi.fn(),
  };
});

const { fetchKennelEvents } = await import("./api");
const mockedFetchKennelEvents = vi.mocked(fetchKennelEvents);

function buildApiRow(overrides: Partial<HashRegoKennelEvent> = {}): HashRegoKennelEvent {
  return {
    slug: "nych3-pub-crawl-2026",
    event_name: "5-boro Pub Crawl",
    host_kennel_slug: "NYCH3",
    start_time: "2026-06-27T19:00:00-04:00",
    current_price: 15,
    has_hares: true,
    opt_hares: "Mystery Hare",
    is_over: false,
    rego_count: 10,
    open_spots: 5,
    creator: "Scribe",
    created: "2026-05-01T12:00:00-04:00",
    modified: "2026-05-01T12:00:00-04:00",
    ...overrides,
  };
}

/** Type guard + assertion: pull `errorDetails.fetch` and fail loudly if absent. */
function fetchErrorsOf(
  result: { errorDetails?: { fetch?: Array<{ url?: string; status?: number; message: string }> } },
): Array<{ url?: string; status?: number; message: string }> {
  const list = result.errorDetails?.fetch;
  expect(list, "expected errorDetails.fetch to be populated").toBeDefined();
  return list ?? [];
}

/** Type guard + assertion: pull `errorDetails.parse` and fail loudly if absent. */
function parseErrorsOf(
  result: { errorDetails?: { parse?: Array<{ row: number; section?: string; error: string; rawText?: string }> } },
): Array<{ row: number; section?: string; error: string; rawText?: string }> {
  const list = result.errorDetails?.parse;
  expect(list, "expected errorDetails.parse to be populated").toBeDefined();
  return list ?? [];
}

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

// ── apiToIndexEntry (round-trip through parseHashRegoDate/parseHashRegoTime) ──

describe("apiToIndexEntry", () => {
  it("round-trips a real API fixture date through parseHashRegoDate", () => {
    // Fixture captured 2026-04-09 from https://hashrego.com/api/kennels/EWH3/events/
    // Contract guard: if startDate emits anything other than MM/DD/YY, the
    // downstream parseHashRegoDate returns null and createFromIndex silently
    // drops the row.
    //
    // NOTE: We intentionally do NOT round-trip startTime through
    // parseHashRegoTime here. parser.ts:133 rejects hours >= 23 as a hare
    // placeholder heuristic, and the real EWH3 fixture's 23:45 start time
    // legitimately fails that check — a pre-existing parser limitation.
    // The synthetic afternoon-time test below covers the shape contract.
    const rows = ewh3Fixture as HashRegoKennelEvent[];
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const entry = apiToIndexEntry(row, "EWH3");
      expect(entry.startDate).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
      expect(entry.startTime).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);

      const parsedDate = parseHashRegoDate(entry.startDate);
      expect(parsedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      const isoMatch = /^(\d{4})-(\d{2})-(\d{2})T/.exec(row.start_time);
      expect(isoMatch).not.toBeNull();
      if (isoMatch === null) continue; // narrows for TS
      const [, y, m, d] = isoMatch;
      expect(parsedDate).toBe(`${y}-${m}-${d}`);
    }
  });

  it("synthetic afternoon time round-trips through parseHashRegoTime", () => {
    const entry = apiToIndexEntry(
      {
        slug: "test",
        event_name: "Afternoon Test",
        host_kennel_slug: "TEST",
        start_time: "2026-05-15T18:30:00+00:00",
        current_price: 0,
        has_hares: false,
        opt_hares: "",
        is_over: false,
        rego_count: 0,
        open_spots: 0,
        creator: "",
        created: "",
        modified: "",
      },
      "TEST",
    );
    expect(entry.startTime).toBe("6:30 PM");
    expect(parseHashRegoTime(entry.startTime)).toBe("18:30");
  });

  it("converts 12:30 noon → 12:30 PM", () => {
    const entry = apiToIndexEntry(
      {
        slug: "test",
        event_name: "Noon Test",
        host_kennel_slug: "TEST",
        start_time: "2026-05-15T12:30:00+00:00",
        current_price: 0,
        has_hares: false,
        opt_hares: "",
        is_over: false,
        rego_count: 0,
        open_spots: 0,
        creator: "",
        created: "",
        modified: "",
      },
      "TEST",
    );
    expect(entry.startTime).toBe("12:30 PM");
    expect(parseHashRegoTime(entry.startTime)).toBe("12:30");
  });

  it("throws on missing start_time", () => {
    expect(() =>
      apiToIndexEntry(
        {
          slug: "test",
          event_name: "Broken",
          host_kennel_slug: "TEST",
          start_time: "",
          current_price: 0,
          has_hares: false,
          opt_hares: "",
          is_over: false,
          rego_count: 0,
          open_spots: 0,
          creator: "",
          created: "",
          modified: "",
        },
        "TEST",
      ),
    ).toThrow(HashRegoApiError);
  });

  it("throws on garbage start_time", () => {
    expect(() =>
      apiToIndexEntry(
        {
          slug: "test",
          event_name: "Broken",
          host_kennel_slug: "TEST",
          start_time: "not a date",
          current_price: 0,
          has_hares: false,
          opt_hares: "",
          is_over: false,
          rego_count: 0,
          open_spots: 0,
          creator: "",
          created: "",
          modified: "",
        },
        "TEST",
      ),
    ).toThrow(/start_time/);
  });
});

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

  it("#806: extracts Host Kennel display name from 'Host Kennel:' block", () => {
    const html = `<html><body>
      <h4>Host Kennel:</h4>
      <div class="half-size pull-left"><a href="/kennels/TH3/"><img alt="logo"></a></div>
      <div class="half-size pull-right"><p><strong><a href="/kennels/TH3/">Tidewater H3</a></strong></p></div>
      <meta property="og:description" content="Some event" />
    </body></html>`;
    const parsed = parseEventDetail(html, "th3-agm-2026-pool-party", {
      slug: "th3-agm-2026-pool-party",
      kennelSlug: "TH3",
      title: "TH3 AGM",
      startDate: "04/19/26",
      startTime: "1:30 PM",
      type: "Trail",
      cost: "$10",
    });
    expect(parsed.hostKennelName).toBe("Tidewater H3");
    expect(parsed.kennelSlug).toBe("TH3");
  });

  it("#806: extracts hares from DOM when og:description lacks Hare(s) field", () => {
    const html = `<html><body>
      <meta property="og:description" content='Some event description without a labeled hares field.' />
      <p class="text-center"><strong>Hare(s):</strong></p>
      <p class="text-center">Always Needs Ample Lube &amp; Shart Tank</p>
    </body></html>`;
    const parsed = parseEventDetail(html, "th3-agm-2026-pool-party");
    expect(parsed.hares).toBe("Always Needs Ample Lube & Shart Tank");
  });

  it("#806: prefers 'Location of event:' address over 'Parking:' block", () => {
    const html = `<html><body>
      <meta property="og:description" content='Cum celebrate AGM 2026.

Parking:
Bayview Elementary School.
1434 E Bayview Blvd, Norfolk, VA 23503

Location of event:
Castle of Princess Shadow.
9405 Alpine Ct, Norfolk, VA 23503' />
    </body></html>`;
    const parsed = parseEventDetail(html, "th3-agm-2026-pool-party");
    expect(parsed.locationAddress).toBe("9405 Alpine Ct, Norfolk, VA 23503");
  });

  it("extracts inline labeled address (same-line label)", () => {
    // Covers reviewer concern: the labeled regex previously required a
    // newline after the label, so `Location: 123 Main St` on one line fell
    // through to the fallback and picked the first (potentially wrong)
    // address in the description.
    const html = `<html><body>
      <meta property="og:description" content='Prelube at the usual spot.

Parking:
999 Wrong Pl, Norfolk, VA 23503

Location of event: 9405 Alpine Ct, Norfolk, VA 23503' />
    </body></html>`;
    const parsed = parseEventDetail(html, "inline-label-test");
    expect(parsed.locationAddress).toBe("9405 Alpine Ct, Norfolk, VA 23503");
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
    expect(events[0].kennelTags[0]).toBe("BFMH3");
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
    mockedFetchKennelEvents.mockReset();
    // Default: throw on any unexpected fetchKennelEvents call. Tests that
    // expect Step 2b activity must opt in via mockResolvedValueOnce or
    // mockImplementationOnce. A permissive empty-array default would let
    // Step 1/Step 3 routing regressions silently pass as "no events".
    mockedFetchKennelEvents.mockImplementation(async (slug: string) => {
      throw new Error(
        `Unexpected fetchKennelEvents call for ${slug} — test should opt in if Step 2b is expected`,
      );
    });
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
    expect(result.events[0].kennelTags[0]).toBe("EWH3");
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
    // NONEXISTENT is not in global index — fetchKennelEvents will be called for Step 2b
    mockedFetchKennelEvents.mockRejectedValueOnce(
      new HashRegoApiError("NONEXISTENT", 404, "not_found"),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { kennelSlugs: ["NONEXISTENT"] });

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext?.totalIndexEntries).toBe(4);
    expect(result.diagnosticContext?.matchingEntries).toBe(0);
    expect(result.diagnosticContext?.kennelSlugsConfigured).toEqual(["NONEXISTENT"]);
  });

  it("fetches kennel events via JSON API when slug has zero global index matches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Set time so event dates (06/27/26) fall within window
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));

    const detailHtml = `<html><head>
      <meta property="og:title" content="06/27 5-boro Pub Crawl" />
      <meta property="og:description" content="A fun event" />
    </head><body><a href="/kennels/NYCH3/">NYCH3</a></body></html>`;

    // Global index (no NYCH3) + any detail page fetches
    fetchSpy.mockImplementation(async () => new Response(detailHtml, { status: 200 }));
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));

    // JSON API returns one upcoming event
    mockedFetchKennelEvents.mockResolvedValueOnce([
      buildApiRow({ slug: "nych3-pub-crawl-2026", start_time: "2026-06-27T19:00:00-04:00" }),
    ]);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    expect(mockedFetchKennelEvents).toHaveBeenCalledWith(
      "NYCH3",
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["NYCH3"]);
    expect((result.diagnosticContext?.kennelPageEventsFound as number)).toBeGreaterThan(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("skips JSON API call when slug has global index matches", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // EWH3 has a match in global index — should go straight to detail page
    fetchSpy.mockResolvedValueOnce(
      new Response(SINGLE_DAY_HTML.replace(/BFMH3/g, "EWH3"), { status: 200 }),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 36500, kennelSlugs: ["EWH3"] });

    // Should NOT have called the JSON API (slug is in global index)
    expect(mockedFetchKennelEvents).not.toHaveBeenCalled();
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual([]);
  });

  it("per-slug API failure stays in errorDetails.fetch, not top-level errors", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    mockedFetchKennelEvents.mockRejectedValueOnce(
      new HashRegoApiError("NYCH3", 0, "network", "ECONNREFUSED"),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["NYCH3"]);
    expect(result.diagnosticContext?.kennelPageEventsFound).toBe(0);
    expect(result.events).toHaveLength(0);
    // Per-slug errors stay in errorDetails.fetch[], never push to top-level errors[]
    expect(result.errors).toHaveLength(0);
    const fetchErrors = fetchErrorsOf(result);
    expect(fetchErrors[0].message).toContain("network");
    expect(fetchErrors[0].url).toContain("/api/kennels/NYCH3/events/");
  });

  it("continues past API failures to reach other slugs with events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // Detail page for any events found via kennel pages
    fetchSpy.mockImplementation(async () => new Response("<html></html>", { status: 200 }));

    // First slug: 502, second: success with events
    mockedFetchKennelEvents
      .mockRejectedValueOnce(new HashRegoApiError("MISS1", 502, "server"))
      .mockResolvedValueOnce([
        buildApiRow({ slug: "nych3-success", start_time: "2026-06-27T19:00:00-04:00" }),
      ]);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 365, kennelSlugs: ["MISS1", "NYCH3"] });
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await promise;

    // Should have attempted both slugs — API failures are non-fatal
    expect(mockedFetchKennelEvents).toHaveBeenCalledTimes(2);
    expect(result.errors).toHaveLength(0);
    expect(result.diagnosticContext?.kennelPagesChecked).toEqual(["MISS1", "NYCH3"]);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
    expect((result.diagnosticContext?.kennelPageEventsFound as number)).toBeGreaterThan(0);
    // And the 502 was recorded in fetch errors
    expect(fetchErrorsOf(result)[0].status).toBe(502);
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
    expect(mockedFetchKennelEvents).not.toHaveBeenCalled();
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

  it("reaches all missing slugs in one scrape (no MAX_KENNEL_PAGES cap)", async () => {
    // Regression: the old browser-render Step 2b capped at 10 kennels per scrape,
    // leaving low-frequency kennels unreachable. The JSON path runs all of them
    // in bounded-concurrency batches with room to spare.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));

    // 15 missing slugs (not in the global index) — all 15 should be checked
    const missingSlugs = Array.from({ length: 15 }, (_, i) => `MISS${i}`);
    // Default mock returns [] (legitimate "no events") — no special per-call setup needed.

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const promise = adapter.fetch(source, { days: 365, kennelSlugs: missingSlugs });

    await vi.advanceTimersByTimeAsync(120_000);

    const result = await promise;
    expect(result.diagnosticContext?.kennelPagesChecked).toHaveLength(15);
    expect(result.diagnosticContext?.kennelPagesSkipped).toBe(0);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBeNull();
    expect(mockedFetchKennelEvents).toHaveBeenCalledTimes(15);
  });

  // ── Row-level parse, PII whitelist, worst-case budget ──

  it("partial success: 1 bad row of 10 emits 9 events + parse error blocks reconcile", async () => {
    vi.useRealTimers(); // parse errors don't involve timers
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    // Detail fetches return 404 → fetchAndParseDetail records the fetch
    // failure AND falls back to createFromIndex(entry), which produces one
    // RawEventData per IndexEntry that has a parseable startDate. This is
    // how we prove the 9 good Step 2b rows actually emit events end-to-end.
    fetchSpy.mockImplementation(async () => new Response("", { status: 404 }));

    const rows: HashRegoKennelEvent[] = Array.from({ length: 10 }, (_, i) =>
      buildApiRow({
        slug: `nych3-row-${i}`,
        start_time: i === 4 ? "garbage" : "2026-06-27T19:00:00-04:00",
      }),
    );
    mockedFetchKennelEvents.mockResolvedValueOnce(rows);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    // 9 valid rows became 9 IndexEntries, then 9 createFromIndex fallback events.
    expect(result.diagnosticContext?.kennelPageEventsFound).toBe(9);
    expect(result.events).toHaveLength(9);
    // Parse error recorded in errorDetails.parse with proper row index.
    const parseErrors = parseErrorsOf(result);
    expect(parseErrors).toHaveLength(1);
    expect(parseErrors[0].row).toBe(4);
    expect(parseErrors[0].section).toBe("NYCH3");
    expect(parseErrors[0].error).toMatch(/start_time/);
    // CRITICAL: row parse failures must push to top-level errors[] so the
    // scrape pipeline's reconcile gate (errors.length === 0) blocks
    // cancellation of the existing canonical event for the dropped row.
    // Without this, a JSON schema drift would silently lose events.
    // The errors[] entry must EXACTLY match the ParseError.error text so AI
    // recovery (scrape.ts:87) can match-and-clean it when the row is
    // successfully recovered. A slug-level summary would never match.
    expect(result.errors).toContain(parseErrors[0].error);
  });

  it("whole-response parse drift (non-array body) marks scrape failed", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockImplementation(async () => new Response("", { status: 404 }));

    // Simulate the API returning a malformed body (kind: "parse", thrown by
    // fetchKennelEvents itself, not a per-row failure).
    mockedFetchKennelEvents.mockRejectedValueOnce(
      new HashRegoApiError("NYCH3", 200, "parse", "expected array, got object"),
    );

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    // Whole-response parse failure must surface to top-level errors[] so the
    // scrape pipeline marks the run failed (matching Step 3 detail-parse
    // semantics). Without this, a kennel API returning broken JSON would
    // silently produce zero events and the scrape would still look healthy.
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.includes("parse") && e.includes("NYCH3"))).toBe(true);
    // And the fetch is still recorded for diagnostics
    expect(fetchErrorsOf(result)[0].message).toContain("parse");
    expect(result.diagnosticContext?.kennelPageFetchErrors).toBe(1);
  });

  it("ParseError.rawText whitelists non-PII fields only", async () => {
    vi.useRealTimers();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));
    fetchSpy.mockImplementation(async () => new Response("<html></html>", { status: 200 }));

    mockedFetchKennelEvents.mockResolvedValueOnce([
      buildApiRow({
        slug: "nych3-bad-row",
        start_time: "not a date",
        event_name: "TITLE WITH PII",
        opt_hares: "Real Name",
        creator: "Nerd Name",
      }),
    ]);

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const result = await adapter.fetch(source, { days: 365, kennelSlugs: ["NYCH3"] });

    const parseErr = parseErrorsOf(result)[0];
    expect(parseErr.rawText).toBeDefined();
    const raw: Record<string, unknown> = JSON.parse(parseErr.rawText ?? "{}");
    // Whitelist: only these keys
    expect(Object.keys(raw).sort((a, b) => a.localeCompare(b))).toEqual(
      ["current_price", "host_kennel_slug", "is_over", "slug", "start_time"],
    );
    // Explicit PII absence
    expect(raw.event_name).toBeUndefined();
    expect(raw.opt_hares).toBeUndefined();
    expect(raw.creator).toBeUndefined();
  });

  it("worst-case budget: slow successful calls hit budget_exhausted cleanly", async () => {
    // Fake timers + advanceTimersByTimeAsync simulate 200 slugs × 4s/call
    // (= 80s wall-clock) inside the test runner without actually waiting. The
    // adapter's budget logic uses Date.now(), which vi.useFakeTimers() does
    // advance, so the 45s STEP2B_BUDGET trips identically to a real run.
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    fetchSpy.mockResolvedValueOnce(new Response(INDEX_HTML, { status: 200 }));

    const missingSlugs = Array.from({ length: 200 }, (_, i) => `SLOW${i}`);

    let activeCalls = 0;
    let maxActive = 0;
    mockedFetchKennelEvents.mockImplementation(async () => {
      activeCalls++;
      maxActive = Math.max(maxActive, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      activeCalls--;
      return [];
    });

    const adapter = new HashRegoAdapter();
    const source = buildSource();
    const startTick = Date.now();
    let settled = false;
    const promise = adapter
      .fetch(source, { days: 365, kennelSlugs: missingSlugs })
      .finally(() => {
        settled = true;
      });
    // Drive the fake clock forward in 1s steps until the promise resolves.
    // Cap at 90s simulated to prevent runaway. Each 1s tick lets pending
    // setTimeout(4000) callbacks fire and lets the next batch launch when
    // the prior one settles.
    for (let elapsed = 0; elapsed < 90_000 && !settled; elapsed += 1_000) {
      await vi.advanceTimersByTimeAsync(1_000);
    }
    const result = await promise;
    const simulatedWall = Date.now() - startTick;

    // Budget should fire between 40s and 55s of SIMULATED time (45s ± one batch).
    expect(simulatedWall).toBeGreaterThanOrEqual(40_000);
    expect(simulatedWall).toBeLessThan(60_000);
    expect(result.diagnosticContext?.kennelPagesStopReason).toBe("budget_exhausted");
    expect((result.diagnosticContext?.kennelPagesChecked as string[]).length).toBeLessThan(200);
    expect((result.diagnosticContext?.kennelPagesSkipped as number)).toBeGreaterThan(50);
    // Concurrency cap must hold throughout
    expect(maxActive).toBeLessThanOrEqual(10);
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
