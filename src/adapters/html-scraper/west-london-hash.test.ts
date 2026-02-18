import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import {
  parseRunNumberFromHeading,
  parseDateFromHeading,
  parseLocationFromHeading,
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
    expect(event!.kennelTag).toBe("WLH3");
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
