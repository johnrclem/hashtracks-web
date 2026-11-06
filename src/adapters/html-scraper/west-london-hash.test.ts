import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunNumberFromHeading,
  parseDateFromHeading,
  parseLocationFromHeading,
  parseStartTimeFromHeading,
  extractPostcode,
  parseRunItem,
} from "./west-london-hash";
import { WestLondonHashAdapter } from "./west-london-hash";

describe("parseRunNumberFromHeading", () => {
  it("parses run number from standard heading", () => {
    expect(
      parseRunNumberFromHeading("Run Number 2081 – 19 February 2026-Clapham Junction"),
    ).toBe(2081);
  });

  it("parses run number with extra spacing", () => {
    expect(parseRunNumberFromHeading("Run  Number  2082")).toBe(2082);
  });

  it("returns null for missing run number", () => {
    expect(parseRunNumberFromHeading("Some other heading")).toBeNull();
  });
});

describe("parseDateFromHeading", () => {
  it("parses standard date", () => {
    expect(
      parseDateFromHeading("Run Number 2081 – 19 February 2026-Clapham Junction"),
    ).toBe("2026-02-19");
  });

  it("parses date with short month", () => {
    expect(parseDateFromHeading("Run Number 2085 – 5 Mar 2026-Putney")).toBe(
      "2026-03-05",
    );
  });

  it("parses single-digit day", () => {
    expect(parseDateFromHeading("Run Number 2090 – 1 January 2027-Ealing")).toBe(
      "2027-01-01",
    );
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromHeading("Run Number 2081 – 19 Flob 2026")).toBeNull();
  });

  it("returns null for no date", () => {
    expect(parseDateFromHeading("Run Number 2081")).toBeNull();
  });
});

describe("parseLocationFromHeading", () => {
  it("extracts location after year-dash", () => {
    expect(
      parseLocationFromHeading("Run Number 2081 – 19 February 2026-Clapham Junction"),
    ).toBe("Clapham Junction");
  });

  it("extracts location with en-dash", () => {
    expect(
      parseLocationFromHeading("Run Number 2082 – 26 February 2026–North Harrow"),
    ).toBe("North Harrow");
  });

  it("returns null when no location", () => {
    expect(parseLocationFromHeading("Run Number 2081 – 19 February 2026")).toBeNull();
  });

  it("returns null for TBA placeholder", () => {
    expect(parseLocationFromHeading("Run Number 2085 – 26 March 2026-TBA")).toBeNull();
  });

  it("returns null for 'Location TBA' placeholder", () => {
    expect(parseLocationFromHeading("Run Number 2085 – 26 March 2026-Location TBA")).toBeNull();
  });

  it("returns null for TBD placeholder", () => {
    expect(parseLocationFromHeading("Run Number 2085 – 26 March 2026-TBD")).toBeNull();
  });
});

// Verbatim headings from westlondonhash.com/runs/ (captured 2026-11-05).
describe("heading formats since Nov 2026 (#2619)", () => {
  it("parses 'Run No' run numbers", () => {
    expect(parseRunNumberFromHeading("Run No 2131 – 21 January 2027 – location TBA")).toBe(2131);
    expect(parseRunNumberFromHeading("Run No 2133-4 February 2027")).toBe(2133);
  });

  it("reads a location after a spaced en dash", () => {
    expect(parseLocationFromHeading("Run Number 2120 – 5 November 2026 – Chiswick NR")).toBe("Chiswick NR");
    expect(parseLocationFromHeading("Run Number 2124- 3 December 2026 – South Ealing tube")).toBe("South Ealing tube");
  });

  it("keeps hyphenated names intact", () => {
    expect(parseLocationFromHeading("Run Number 2103 – 23 July 2026 – Ealing Common-AGPU")).toBe("Ealing Common-AGPU");
  });

  it("drops location-TBA, hare-needed and start-time segments", () => {
    expect(parseLocationFromHeading("Run Number 2123 – 26 November 2026 – location TBA")).toBeNull();
    expect(parseLocationFromHeading("Run No 2132 – 28 January 2027 – hare needed")).toBeNull();
    expect(parseLocationFromHeading("Run No 2128 – 31 December 2026 – location TBA – 12.15 start time")).toBeNull();
    expect(parseLocationFromHeading("Run No 2129 -7 January  2027 – location TBA")).toBeNull();
  });

  it("reads a lunchtime start time from the heading", () => {
    expect(parseStartTimeFromHeading("Run No 2127 – 24 December 2026 – location TBA – 12.15 start time")).toBe("12:15");
    expect(parseStartTimeFromHeading("Run Number 2120 – 5 November 2026 – Chiswick NR")).toBeUndefined();
  });

  it("builds clean titles with run number and start time", () => {
    const $ = cheerio.load(`<ul class="wp-block-post-template">
      <li><h4><a href="/runs/2123/">Run Number 2123 &#8211; 26 November 2026 &#8211; location TBA</a></h4></li>
      <li><h4><a href="/runs/2127/">Run No 2127 &#8211; 24 December 2026 &#8211; location TBA &#8211; 12.15 start time</a></h4></li>
      <li><h4><a href="/runs/2122/">Run Number 2122 &#8211; 19 November 2026 &#8211; Bermondsey tube</a></h4></li>
    </ul>`);
    const items = $(".wp-block-post-template > li");
    const tba = parseRunItem($, items.eq(0), "https://westlondonhash.com/runs/");
    expect(tba?.title).toBe("WLH3 Run #2123");
    expect(tba?.runNumber).toBe(2123);
    const xmas = parseRunItem($, items.eq(1), "https://westlondonhash.com/runs/");
    expect(xmas?.title).toBe("WLH3 Run #2127");
    expect(xmas?.date).toBe("2026-12-24");
    expect(xmas?.startTime).toBe("12:15");
    const named = parseRunItem($, items.eq(2), "https://westlondonhash.com/runs/");
    expect(named?.title).toBe("WLH3 Run #2122 - Bermondsey tube");
    expect(named?.startTime).toBe("19:15");
  });
});

describe("extractPostcode", () => {
  it("extracts from full address", () => {
    expect(
      extractPostcode("The Roundhouse, 2 North Side Wandsworth Common, London SW18 2SS"),
    ).toBe("SW18 2SS");
  });

  it("returns null when no postcode", () => {
    expect(extractPostcode("Some pub in London")).toBeNull();
  });
});

const SAMPLE_HTML = `
<div class="wp-block-post-template is-flex-container columns-2">
  <li>
    <h4><a href="/runs/run-number-2081-19-february-2026/">Run Number 2081 – 19 February 2026-Clapham Junction</a></h4>
    <p>Hares - Alice and Bobo</p>
    <p>The Roundhouse, 2 North Side Wandsworth Common, London SW18 2SS</p>
  </li>
  <li>
    <h4><a href="/runs/run-number-2082-26-february-2026/">Run Number 2082 – 26 February 2026-North Harrow</a></h4>
    <p>Hare – Charlie</p>
    <p>The Castle, St Anns Road, Harrow HA1 1AS</p>
  </li>
  <li>
    <h4><a href="/runs/run-number-2083-5-march-2026/">Run Number 2083 – 5 March 2026-TBD</a></h4>
    <p>Hares - TBD</p>
  </li>
</div>
<a href="/runs/?query-17-page=2">Next Page</a>
`;

describe("parseRunItem", () => {
  const $ = cheerio.load(SAMPLE_HTML);
  const items = $(".wp-block-post-template > li");

  it("parses first run with all fields", () => {
    const event = parseRunItem($, items.eq(0), "https://westlondonhash.com/runs/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-19");
    expect(event!.kennelTags[0]).toBe("wlh3");
    expect(event!.runNumber).toBe(2081);
    expect(event!.hares).toBe("Alice and Bobo");
    expect(event!.location).toContain("Roundhouse");
    expect(event!.locationUrl).toContain("SW18");
    expect(event!.startTime).toBe("19:15");
    expect(event!.sourceUrl).toContain("run-number-2081");
  });

  it("parses second run with en-dash hare separator", () => {
    const event = parseRunItem($, items.eq(1), "https://westlondonhash.com/runs/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-26");
    expect(event!.runNumber).toBe(2082);
    expect(event!.hares).toBe("Charlie");
    expect(event!.location).toContain("Castle");
  });

  it("parses TBD run with minimal data", () => {
    const event = parseRunItem($, items.eq(2), "https://westlondonhash.com/runs/");
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-05");
    expect(event!.runNumber).toBe(2083);
    expect(event!.hares).toBe("TBD");
  });

  it("uses just the postcode when paragraph text exceeds 120 chars", () => {
    const longParagraphHtml = `
      <div class="wp-block-post-template is-flex-container columns-2">
        <li>
          <h4><a href="/runs/run-number-2090/">Run Number 2090 – 1 April 2026-Wimbledon</a></h4>
          <p>Hares - Eve and Frank</p>
          <p>This is a really long description of the venue that goes on and on about how to get there and what to expect when you arrive at the location near Wimbledon Common which has postcode SW19 4RD in it somewhere.</p>
        </li>
      </div>
    `;
    const $long = cheerio.load(longParagraphHtml);
    const longItems = $long(".wp-block-post-template > li");
    const event = parseRunItem($long, longItems.eq(0), "https://westlondonhash.com/runs/");
    expect(event).not.toBeNull();
    // Should extract just the postcode, not the entire paragraph
    expect(event!.location).toBe("SW19 4RD");
  });
});

describe("WestLondonHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new WestLondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://westlondonhash.com/runs/",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    // Page 1 has "Next Page" link, page 2 is empty (no more pagination)
    expect(result.diagnosticContext).toMatchObject({
      pagesFetched: 2,
      eventsParsed: 3,
    });

    fetchSpy.mockRestore();
  });

  it("follows pagination links", async () => {
    const page2Html = `
      <div class="wp-block-post-template is-flex-container columns-2">
        <li>
          <h4><a href="/runs/run-number-2084/">Run Number 2084 – 12 March 2026-Putney</a></h4>
          <p>Hare – Diana</p>
        </li>
      </div>
    `;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response(page2Html, { status: 200 }));

    const adapter = new WestLondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://westlondonhash.com/runs/",
    } as never);

    // 3 from page 1 + 1 from page 2
    expect(result.events).toHaveLength(4);
    expect(result.diagnosticContext).toMatchObject({ pagesFetched: 2 });

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new WestLondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://westlondonhash.com/runs/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });
});
