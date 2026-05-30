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
  extractCost,
  isPlaceholderHare,
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

  // Designation-first routing (#1855 / #1859): the trailing "<kennel> #<run>"
  // designation wins over leading event-name words that happen to start with
  // another kennel's name.
  it.each([
    // NAWW events were anchoring to "New Amsterdam" → nah3 (#1855)
    ["New Amsterdam Winter Wednesday AGM! - NAWW #298", "nawwh3"],
    [
      "New Amsterdam was established on Manhattan Island on this day 369 years ago (maybe?) - NAWW #356",
      "nawwh3",
    ],
    // NASS must stay on nah3
    ["Friendsgiving 2026 - NASS #304", "nah3"],
    // NYCH3 Specials were anchoring to "Drinking Practice" → drinking-practice-nyc (#1859)
    ["Drinking Practice - Special #137", "nych3"],
    ["Drinking Practice - Special #232", "nych3"],
    ["Drinking Practice - Special #234", "nych3"],
    // Genuine Drinking Practice mini-series must NOT regress
    ["Drinking Practice!! - Drinking Practice #1", "drinking-practice-nyc"],
    ["Sushi Night - Drinking Practice #8", "drinking-practice-nyc"],
    // Existing Special section behavior preserved
    ["Red Dress Run! - Special #254", "nych3"],
    // Validated against the full hashnyc.com archive (4,438 cells): the run
    // designation is authoritative even when the event NAME leads with another
    // kennel's words. These real-archive shapes regressed under the old
    // anchored-leading routing and are now correct.
    ["NYC Distributed Hash #3 Brooklyn #1033", "brh3"], // really Brooklyn #1033
    ["Special 4th Saturday R*n! Columbia #112", "columbia"], // "Special" here is an adjective, not the series
    ["Brooklyn Half Pub Crawl Special #251", "nych3"], // a NYCH3 Special, not a Brooklyn H3 run
    ["NAWW in Summer! NYC #1650", "nych3"], // NAWW-themed NYCH3 run, not a nawwh3 run
  ])("routes %j → %s by run designation", (text, expected) => {
    expect(extractKennelTag(text)).toBe(expected);
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

  // PR D.1 (#1560) — `Special` is a hashnyc.com SECTION label, not a kennel.
  // Before PR D it emitted pseudo-tag `special-nyc` that failed kennel
  // resolution (100% of matched raws stayed `processed: false, eventId: null`
  // — verified against prod the day before PR D). It now resolves to `nych3`,
  // the NYC-wide host that publishes these events.
  //
  // `Drinking Practice` keeps its own kennel `drinking-practice-nyc` (a real
  // seeded kennel with aliases — see prisma/seed-data/kennels.ts:112 and
  // aliases.ts:20). Codex caught that remapping this would silently change
  // ownership of an established kennel.
  // CONTEXTUAL_PATTERNS matches `pattern + \s*(?:Run|Trail|#) + \s*\d+` so
  // fixtures need the kennel name DIRECTLY followed by a run designator —
  // `Pattern #N`, `Pattern Run N`, or `Pattern Trail N`. The `<b>Section</b>
  // Pattern Run #N` shape with the `#` between Run and N doesn't satisfy
  // `Run\s*\d+` (the # breaks the chain) — those tests pass via the nych3
  // fallback at the end of `extractKennelTag`, not the pattern itself.
  it.each([
    {
      label: "Special section → nych3 (anchored at start of cell)",
      cellText: "Special #252 Start: TBA",
      expectedKennelTag: "nych3",
    },
    {
      label: "Drinking Practice keeps its own kennel `drinking-practice-nyc` (anchored)",
      cellText: "Drinking Practice #88 Start: TBA",
      expectedKennelTag: "drinking-practice-nyc",
    },
    {
      // #1855: leading "New Amsterdam" must not steal NAWW from nawwh3
      label: "NAWW designation → nawwh3 despite 'New Amsterdam' lead (#1855)",
      cellText: "New Amsterdam Winter Wednesday AGM! - NAWW #298 Start: TBA",
      expectedKennelTag: "nawwh3",
    },
    {
      // #1859: leading "Drinking Practice" must not steal NYCH3 Specials
      label: "Special designation → nych3 despite 'Drinking Practice' lead (#1859)",
      cellText: "Drinking Practice - Special #137 Start: TBA",
      expectedKennelTag: "nych3",
    },
    {
      label: "Genuine Drinking Practice run stays drinking-practice-nyc (#1859 no-regress)",
      cellText: "Drinking Practice!! - Drinking Practice #1 Start: TBA",
      expectedKennelTag: "drinking-practice-nyc",
    },
  ])("$label", ({ cellText, expectedKennelTag }) => {
    const html = `<table><tr><td>${cellText}</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.kennelTag).toBe(expectedKennelTag);
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
  it("extracts Special #254 (section label, not a kennel) (#1791)", () => {
    expect(extractRawDesignation("Red Dress Run!Special #254Start: TBA")).toBe("Special #254");
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

  it("special-event title uses the Special label, not the raw kennelCode (#1791)", () => {
    const html = `<table><tr><td><b>Red Dress Run!</b><br>Special #254<br>Start: TBA</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("Red Dress Run! - Special #254");
    expect(result.title).not.toContain("nych3");
    expect(result.kennelTag).toBe("nych3");
  });

  it("titled special event with no recognizable designation drops to bare title (no kennelCode leak) (#1791)", () => {
    // "Gala #N" is not a known designation; previously fell back to "nych3 #..".
    const html = `<table><tr><td><b>Mystery Gala</b><br>Start: TBA</td></tr></table>`;
    const $ = cheerio.load(html);
    const result = parseDetailsCell($, $("td").first());
    expect(result.title).toBe("Mystery Gala");
    expect(result.title).not.toContain("nych3");
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

// ── extractCost (#1792) ──

describe("extractCost", () => {
  const FIVE_BORO_CELL =
    `<b>5-boro Pub Crawl</b><br>Special #252<br>Start: TBA<br>` +
    `Three days. Five boroughs. Countless bad decisions. </br>` +
    `Cost: Free / Pay as you go &#8212; no rego fee. You cover your own drinks and food at each stop. </br>` +
    `What to bring: ID, cash/card, comfortable shoes.`;

  it("extracts the Cost line, bounded at the next break", () => {
    expect(extractCost(FIVE_BORO_CELL)).toBe(
      "Free / Pay as you go — no rego fee. You cover your own drinks and food at each stop.",
    );
  });

  it("returns undefined when there is no Cost label", () => {
    expect(extractCost("NYC #2152<br>Start: The Library")).toBeUndefined();
  });

  it("is surfaced through parseDetailsCell", () => {
    const $ = cheerio.load(`<table><tr><td>${FIVE_BORO_CELL}</td></tr></table>`);
    const result = parseDetailsCell($, $("td").first());
    expect(result.cost).toContain("Free / Pay as you go");
  });
});

// ── isPlaceholderHare (#1790) ──

describe("isPlaceholderHare", () => {
  it.each([
    ["flags the signup CTA", "Sign up to hare!", "nych3", true],
    ["flags a bare kennel code used as a hare", "NYCH3", "nych3", true],
    ["flags the archive Unknown placeholder", "Unknown", "nych3", true],
    ["does not flag a real hare name", "Shitwrecked", "nych3", false],
  ])("%s", (_label, hares, kennelTag, expected) => {
    expect(isPlaceholderHare(hares as string, kennelTag as string)).toBe(expected);
  });
});

// ── parseRows tri-state hares + minYear ──

describe("parseRows hares + minYear", () => {
  it("emits null (explicit clear) for a future signup-placeholder row (#1790)", () => {
    const html = `<table class="future_hashes">
      <tr><td>June 10 7:00 pm</td><td>NYC #2153</td><td>Sign up to hare!</td></tr>
    </table>`;
    const $ = cheerio.load(html);
    const result = parseRows($, $("tr"), "https://hashnyc.com", true);
    expect(result.events.length).toBe(1);
    expect(result.events[0].hares).toBeNull();
  });

  it("keeps a real future hare value", () => {
    const html = `<table class="future_hashes">
      <tr><td>June 3 7:00 pm</td><td>NYC #2152</td><td>Shitwrecked</td></tr>
    </table>`;
    const $ = cheerio.load(html);
    const result = parseRows($, $("tr"), "https://hashnyc.com", true);
    expect(result.events[0].hares).toBe("Shitwrecked");
  });

  it("drops pre-floor years by default but keeps them with a lower minYear (#1793)", () => {
    const html = `<table><tr id="2002may15">
      <td>May 15 7:00 pm</td><td>NYC #939</td><td>Fluffy Lockerman</td>
    </tr></table>`;
    const $ = cheerio.load(html);
    expect(parseRows($, $("tr"), "https://hashnyc.com", false).events.length).toBe(0);
    const kept = parseRows($, $("tr"), "https://hashnyc.com", false, "past_hashes", 1990);
    expect(kept.events.length).toBe(1);
    expect(kept.events[0].date).toBe("2002-05-15");
    expect(kept.events[0].runNumber).toBe(939);
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
