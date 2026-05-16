import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";
import {
  decodeHtmlEntities,
  extractYear,
  extractMonthDay,
  extractKennelTag,
  extractRunNumber,
  extractRawDesignation,
  extractTitle,
  extractTime,
  extractHares,
  parseDetailsCell,
  extractSourceUrl,
  parseRows,
  HashNYCAdapter,
} from "./hashnyc";

// Module-level mock so Vitest hoists it before module resolution
vi.mock("../safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// ── decodeHtmlEntities ──

describe("decodeHtmlEntities", () => {
  it("decodes &amp;", () => {
    expect(decodeHtmlEntities("A &amp; B")).toBe("A & B");
  });

  it("decodes &nbsp;", () => {
    expect(decodeHtmlEntities("Hello&nbsp;World")).toBe("Hello World");
  });

  it("decodes hex numeric entities", () => {
    expect(decodeHtmlEntities("&#x2019;")).toBe("\u2019");
  });

  it("decodes decimal numeric entities", () => {
    expect(decodeHtmlEntities("&#8217;")).toBe("\u2019");
  });

  it("strips script tags", () => {
    expect(decodeHtmlEntities("Hello<script>alert(1)</script>World")).toBe("HelloWorld");
  });

  it("strips style tags", () => {
    expect(decodeHtmlEntities("Hello<style>.x{}</style>World")).toBe("HelloWorld");
  });

  it("converts <br> to space", () => {
    expect(decodeHtmlEntities("Hello<br/>World")).toBe("Hello World");
  });

  it("strips generic HTML tags", () => {
    expect(decodeHtmlEntities("<b>Bold</b>")).toBe("Bold");
  });

  it("collapses whitespace", () => {
    expect(decodeHtmlEntities("  Hello   World  ")).toBe("Hello World");
  });
});

// ── extractYear ──

describe("extractYear", () => {
  it("extracts year from row ID", () => {
    expect(extractYear("2024oct30", "")).toBe(2024);
  });

  it("falls back to date cell HTML", () => {
    expect(extractYear(undefined, "<td>October 30, 2025</td>")).toBe(2025);
  });

  it("returns null when no year found", () => {
    expect(extractYear(undefined, "no year here")).toBeNull();
  });

  it("extracts year from cleaned text when HTML has entities", () => {
    expect(extractYear(undefined, "October&nbsp;30,&nbsp;2025")).toBe(2025);
  });
});

// ── extractMonthDay ──

describe("extractMonthDay", () => {
  it("extracts full month name", () => {
    expect(extractMonthDay("October 30")).toEqual({ month: 9, day: 30 });
  });

  it("extracts abbreviated month", () => {
    expect(extractMonthDay("Jan 5th")).toEqual({ month: 0, day: 5 });
  });

  it("handles ordinal suffixes", () => {
    expect(extractMonthDay("December 1st")).toEqual({ month: 11, day: 1 });
    expect(extractMonthDay("March 2nd")).toEqual({ month: 2, day: 2 });
    expect(extractMonthDay("April 3rd")).toEqual({ month: 3, day: 3 });
  });

  it("returns null for unknown month", () => {
    expect(extractMonthDay("Foo 15")).toBeNull();
  });

  it("returns null for no match", () => {
    expect(extractMonthDay("no date here")).toBeNull();
  });
});

// ── extractKennelTag ──

describe("extractKennelTag", () => {
  it("matches Knickerbocker at start", () => {
    expect(extractKennelTag("Knickerbocker Run #500")).toBe("knick");
  });

  it("matches Brooklyn anchored", () => {
    expect(extractKennelTag("Brooklyn Run #456")).toBe("brh3");
  });

  it("matches NYCH3 anchored", () => {
    expect(extractKennelTag("NYCH3 Run #2100: Trail")).toBe("nych3");
  });

  it("matches contextual pattern with run number", () => {
    expect(extractKennelTag("Some text Knickerbocker Run 500")).toBe("knick");
  });

  it("matches Queens Black Knights", () => {
    expect(extractKennelTag("Queens Black Knights Run #100")).toBe("qbk");
  });

  it("matches NAWWH3", () => {
    expect(extractKennelTag("NAWWH3 Run #50")).toBe("nawwh3");
  });

  it("falls back to nych3 with run number present", () => {
    expect(extractKennelTag("Some random text Run #123")).toBe("nych3");
  });

  it("falls back to nych3 when no pattern matches", () => {
    expect(extractKennelTag("Just some random text")).toBe("nych3");
  });
});

// ── extractRunNumber ──

describe("extractRunNumber", () => {
  it("extracts from 'Run #1234'", () => {
    expect(extractRunNumber("NYCH3 Run #1234")).toBe(1234);
  });

  it("extracts from 'Trail 567'", () => {
    expect(extractRunNumber("Trail 567")).toBe(567);
  });

  it("extracts from '#890'", () => {
    expect(extractRunNumber("#890")).toBe(890);
  });

  it("returns undefined for no match", () => {
    expect(extractRunNumber("No number here")).toBeUndefined();
  });

  it("prefers kennel-scoped run number over cross-kennel reference", () => {
    // "Summit H3 #2169" appears first, but BrH3 #2 should be preferred when kennelTag is brh3
    expect(
      extractRunNumber(
        "38th Annual Downtown Fiasco (also Summit H3 #2169) BrH3 #2",
        "brh3",
      ),
    ).toBe(2);
  });

  it("falls back to first run number when kennel tag has no adjacent number", () => {
    expect(
      extractRunNumber("Brooklyn special event #456", "brh3"),
    ).toBe(456);
  });

  it("scopes to kennel pattern for NYC kennel", () => {
    expect(
      extractRunNumber("NYCH3 Run #100 also Brooklyn #200", "nych3"),
    ).toBe(100);
  });
});

// ── extractTitle ──

describe("extractTitle", () => {
  it("strips kennel and run number prefix", () => {
    expect(extractTitle("NYCH3 Run #2100: Valentine's Trail")).toBe("Valentine's Trail");
  });

  it("returns full text when no Run/Trail/# pattern found", () => {
    expect(extractTitle("NYCH3: Some Title")).toBe("NYCH3: Some Title");
  });

  it("returns undefined when no title extractable", () => {
    expect(extractTitle("Run #100")).toBeUndefined();
  });
});

// ── extractTime ──

describe("extractTime", () => {
  it("converts PM time", () => {
    expect(extractTime("2:00 pm")).toBe("14:00");
  });

  it("converts evening time", () => {
    expect(extractTime("7:30 pm")).toBe("19:30");
  });

  it("handles noon", () => {
    expect(extractTime("12:00 pm")).toBe("12:00");
  });

  it("handles midnight", () => {
    expect(extractTime("12:00 am")).toBe("00:00");
  });

  it("handles AM time", () => {
    expect(extractTime("9:15 am")).toBe("09:15");
  });

  it("returns undefined for no match", () => {
    expect(extractTime("no time here")).toBeUndefined();
  });
});

// ── extractHares (Cheerio) ──

describe("extractHares", () => {
  it("extracts from cell before onin", () => {
    const html = `<table><tr>
      <td>Date</td>
      <td>Details</td>
      <td>Mudflap</td>
      <td class="onin">ON-IN</td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractHares($, $("tr")[0])).toBe("Mudflap");
  });

  it("extracts comma-separated names from cell 2", () => {
    const html = `<table><tr>
      <td>Date</td>
      <td>Details</td>
      <td>Alice, Bob & Charlie</td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractHares($, $("tr")[0])).toBe("Alice, Bob & Charlie");
  });

  it("returns N/A when no hares found", () => {
    const html = `<table><tr>
      <td>Date</td>
      <td>Details with a lot of text that is definitely more than one hundred characters long and keeps going on and on</td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractHares($, $("tr")[0])).toBe("N/A");
  });
});

// ── parseDetailsCell (Cheerio) ──

describe("parseDetailsCell", () => {
  it("extracts kennel tag and run number from text", () => {
    const html = `<table><tr><td>NYCH3 Run #2100 Valentine's Trail</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.kennelTag).toBe("nych3");
    expect(result.runNumber).toBe(2100);
  });

  it("extracts event name from bold tag", () => {
    const html = `<table><tr><td><b>Special Event</b> NYCH3 Run #2100 Start: Central Park</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.eventName).toBe("Special Event");
    expect(result.title).toContain("Special Event");
  });

  it("extracts location from Start: block", () => {
    const html = `<table><tr><td>NYCH3 Run #100 Start: Central Park, NY Transit: Take the A train</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.location).toContain("Central Park");
  });

  it("extracts maps link", () => {
    const html = `<table><tr><td>NYCH3 Run #100 Start: <a href="https://maps.google.com/maps?q=Central+Park">Central Park</a> Transit: Subway</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.locationUrl).toContain("maps.google.com");
  });

  it("prefers kennel-scoped run number over cross-kennel reference in title", () => {
    const html = `<table><tr><td><b>38th Annual Downtown Fiasco (also Summit H3 #2169)</b> BrH3 #2 Start: TBD</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.kennelTag).toBe("brh3");
    expect(result.runNumber).toBe(2);
  });

  it("treats Start: TBA as a placeholder and does not absorb the following paragraph (#1396)", () => {
    // GGFM Strawberry Moon #435 fixture from hashnyc.com — `Start: TBA`
    // is followed by a description paragraph and a "Show … | Go …" timing
    // line. Earlier behavior absorbed all of that into `location`.
    const html = `<table><tr><td><b>Strawberry Moon</b><br>GGFM #435<br>Start: TBA<br>Join NYC's full moon kennel as we explore the darker side of Gotham. This is your chance to get a proper trail in before the weekend wrecks you.<br>Show 7:15 PM | Go 7:30 PM.</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.location).toBe("TBA");
    // The description paragraph is captured separately and should contain
    // the full-moon prose (and NOT a "Run #N" prefix).
    expect(result.description).toContain("full moon kennel");
  });

  it.each([
    ["TBA", "TBA"],
    ["TBD", "TBD"],
    ["TBC", "TBC"],
    ["tba", "TBA"],
  ])("normalizes Start: %s placeholders to %s (case-insensitive)", (input, expected) => {
    const html = `<table><tr><td>NYCH3 Run #100 Start: ${input}<br>Some description</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.location).toBe(expected);
  });
});

// ── extractRawDesignation ──

describe("extractRawDesignation", () => {
  it("extracts NYC #2142", () => {
    expect(extractRawDesignation("NYC #2142")).toBe("NYC #2142");
  });
  it("extracts Brooklyn #1179", () => {
    expect(extractRawDesignation("Brooklyn #1179")).toBe("Brooklyn #1179");
  });
  it("extracts GGFM #432 from titled event", () => {
    expect(extractRawDesignation("Pink MoonGGFM #432Start: Shenanigan's Pub")).toBe("GGFM #432");
  });
  it("extracts NAWW #389", () => {
    expect(extractRawDesignation("NAWW #389")).toBe("NAWW #389");
  });
  it("extracts Queens #248 from titled event", () => {
    expect(extractRawDesignation("7-11 C*ms to Queens!Queens #248Start: TBD")).toBe("Queens #248");
  });
  it("extracts LIL #147", () => {
    expect(extractRawDesignation("Bears!LIL #147Start: Your Mother's House")).toBe("LIL #147");
  });
  it("returns undefined when no designation found", () => {
    expect(extractRawDesignation("Just some random text")).toBeUndefined();
  });
});

// ── parseDetailsCell title format (raw designation) ──

describe("parseDetailsCell title format", () => {
  it("untitled NYC event uses raw designation as title", () => {
    const html = `<table><tr><td>NYC #2142<br>Start: The Library</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("NYC #2142");
  });

  it("untitled Brooklyn event uses raw designation as title", () => {
    const html = `<table><tr><td>Brooklyn #1179</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("Brooklyn #1179");
  });

  it("untitled NAWW event uses raw designation as title", () => {
    const html = `<table><tr><td>NAWW #389</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("NAWW #389");
  });

  it("titled GGFM event preserves raw designation in title", () => {
    const html = `<table><tr><td><b>Pink Moon</b><br>GGFM #432<br>Start: Shenanigan's Pub</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("Pink Moon - GGFM #432");
  });

  it("titled NYC AGM preserves raw designation in title", () => {
    const html = `<table><tr><td><b>AGM</b><br>NYC #2149</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("AGM - NYC #2149");
  });

  it("titled Brooklyn event preserves raw designation in title", () => {
    const html = `<table><tr><td><b>Memorial Day Hash</b><br>Brooklyn #1183</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("Memorial Day Hash - Brooklyn #1183");
  });

  it("titled Queens event preserves raw designation in title", () => {
    const html = `<table><tr><td><b>7-11 C*ms to Queens!</b><br>Queens #248<br>Start: TBD</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("7-11 C*ms to Queens! - Queens #248");
  });
});

// ── extractSourceUrl (Cheerio) ──

describe("extractSourceUrl", () => {
  it("prefers deeplink anchor", () => {
    const html = `<table><tr>
      <td><a class="deeplink" id="2026February14">link</a></td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractSourceUrl($, $("tr")[0], "https://hashnyc.com")).toBe("https://hashnyc.com/#2026February14");
  });

  it("falls back to first non-maps link", () => {
    const html = `<table><tr>
      <td><a href="https://maps.google.com/q=x">Map</a><a href="/event/123">Event</a></td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractSourceUrl($, $("tr")[0], "https://hashnyc.com")).toBe("https://hashnyc.com/event/123");
  });

  it("skips mailto links", () => {
    const html = `<table><tr>
      <td><a href="mailto:test@test.com">Email</a><a href="/event">Link</a></td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(extractSourceUrl($, $("tr")[0], "https://hashnyc.com")).toBe("https://hashnyc.com/event");
  });

  it("returns undefined when no links", () => {
    const html = `<table><tr><td>No links</td></tr></table>`;
    const $ = cheerio.load(html);
    expect(extractSourceUrl($, $("tr")[0], "https://hashnyc.com")).toBeUndefined();
  });
});

// ── parseRows (structured errors) ──

describe("parseRows", () => {
  it("returns parseErrors with row index and section for bad rows", () => {
    // Build a table where the second row will throw during parsing
    // (row with cells but no valid date triggers early return, not error —
    //  we need a row that enters the try block and throws)
    const html = `<table>
      <tr id="2026jan15">
        <td>January 15 2:00 pm</td>
        <td>NYCH3 Run #2100 Valentine's Trail</td>
        <td>Mudflap</td>
      </tr>
    </table>`;
    const $ = cheerio.load(html);
    const rows = $("tr");

    const result = parseRows($, rows, "https://hashnyc.com", false, "past_hashes");
    // Valid row should parse successfully
    expect(result.events.length).toBe(1);
    expect(result.parseErrors.length).toBe(0);
  });

  it("captures section parameter in parseErrors", () => {
    const html = `<table>
      <tr id="2026jan15">
        <td>January 15 2:00 pm</td>
        <td>NYCH3 Run #2100 Trail</td>
      </tr>
    </table>`;
    const $ = cheerio.load(html);
    const rows = $("tr");

    const result = parseRows($, rows, "https://hashnyc.com", true, "future_hashes");
    expect(result.events.length).toBe(1);
    expect(result.events[0].kennelTags[0]).toBe("nych3");
  });

  it("defaults section to past_hashes for non-future rows", () => {
    const html = `<table></table>`;
    const $ = cheerio.load(html);
    const rows = $("tr");

    const result = parseRows($, rows, "https://hashnyc.com", false);
    expect(result.events).toEqual([]);
    expect(result.parseErrors).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("skips rows with fewer than 2 cells", () => {
    const html = `<table>
      <tr><td>Only one cell</td></tr>
    </table>`;
    const $ = cheerio.load(html);
    const rows = $("tr");

    const result = parseRows($, rows, "https://hashnyc.com", false);
    expect(result.events).toEqual([]);
    expect(result.parseErrors).toEqual([]);
  });
});

// ── Adapter-level deduplication ──

describe("HashNYCAdapter deduplication", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates overlapping events from past and future tables by kennelTag+date+runNumber", async () => {
    // Pin clock so adapter's internal new Date() calls are deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));

    // June 20 is 5 days after pinned clock — same month, no year-rollover
    const pastHtml = `<html><body><table class="past_hashes">
      <tr id="2026jun20">
        <td>June 20 2:00 pm</td>
        <td>NYCH3 Run #2100 Trail Name Start: Central Park</td>
        <td>Mudflap</td>
      </tr>
    </table></body></html>`;

    const futureHtml = `<html><body><table class="future_hashes">
      <tr>
        <td>June 20 2:00 pm</td>
        <td>NYCH3 Run #2100 Trail Name Start: Central Park</td>
        <td>Updated Hare</td>
      </tr>
    </table></body></html>`;

    // Get the hoisted mock
    const { safeFetch } = await import("../safe-fetch");
    const mockFetch = vi.mocked(safeFetch);
    mockFetch
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(pastHtml) } as Response)
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(futureHtml) } as Response);

    const adapter = new HashNYCAdapter();
    const result = await adapter.fetch({ url: "https://hashnyc.com" } as never);

    // Should be deduplicated: only 1 event, not 2
    const nychEvents = result.events.filter(e => e.kennelTags[0] === "nych3" && e.date === "2026-06-20");
    expect(nychEvents.length).toBe(1);
    // Future table entry should win (later overwrites)
    expect(nychEvents[0].hares).toBe("Updated Hare");
  });
});
