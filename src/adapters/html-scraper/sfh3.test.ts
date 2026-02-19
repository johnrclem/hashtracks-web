import { describe, it, expect, vi } from "vitest";
import { parseSFH3Date, extractLocationUrl, parseHarelineRows } from "./sfh3";
import { SFH3Adapter } from "./sfh3";

describe("parseSFH3Date", () => {
  it("parses M/D/YYYY format", () => {
    expect(parseSFH3Date("3/3/2026")).toBe("2026-03-03");
  });

  it("parses MM/DD/YYYY format", () => {
    expect(parseSFH3Date("03/03/2026")).toBe("2026-03-03");
  });

  it("parses day-of-week prefixed date", () => {
    expect(parseSFH3Date("Monday 3/3/2026")).toBe("2026-03-03");
  });

  it("parses abbreviated day-of-week", () => {
    expect(parseSFH3Date("Mon 3/3/2026")).toBe("2026-03-03");
  });

  it("parses 12/31/2025", () => {
    expect(parseSFH3Date("Tuesday 12/31/2025")).toBe("2025-12-31");
  });

  it("returns null for empty string", () => {
    expect(parseSFH3Date("")).toBeNull();
  });

  it("returns null for text without a date", () => {
    expect(parseSFH3Date("No date here")).toBeNull();
  });

  it("returns null for invalid month", () => {
    expect(parseSFH3Date("13/1/2026")).toBeNull();
  });

  it("returns null for invalid day", () => {
    expect(parseSFH3Date("1/32/2026")).toBeNull();
  });
});

describe("extractLocationUrl", () => {
  it("extracts Google Maps URL", () => {
    const html = '<a href="https://maps.google.com/?q=37.7694,-122.4862">Golden Gate Park</a>';
    expect(extractLocationUrl(html)).toBe("https://maps.google.com/?q=37.7694,-122.4862");
  });

  it("extracts Google Maps URL with different domain", () => {
    const html = '<a href="https://www.google.com/maps/place/37.7694,-122.4862">Location</a>';
    expect(extractLocationUrl(html)).toBe("https://www.google.com/maps/place/37.7694,-122.4862");
  });

  it("returns undefined for non-maps link", () => {
    const html = '<a href="https://example.com">Some Link</a>';
    expect(extractLocationUrl(html)).toBeUndefined();
  });

  it("returns undefined for plain text (no link)", () => {
    expect(extractLocationUrl("Golden Gate Park")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractLocationUrl("")).toBeUndefined();
  });
});

const SAMPLE_HTML = `
<html>
<body>
<table>
  <thead>
    <tr>
      <th>Run#</th>
      <th>When</th>
      <th>Hare</th>
      <th>Where</th>
      <th>What</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="/runs/1234">2302</a></td>
      <td>Monday 3/3/2026</td>
      <td>Trail Blazer</td>
      <td><a href="https://maps.google.com/?q=37.7694,-122.4862">Golden Gate Park</a></td>
      <td>SFH3 #2302: A Very Heated Rivalry</td>
    </tr>
    <tr>
      <td><a href="/runs/1235">1700</a></td>
      <td>Thursday 3/6/2026</td>
      <td>Captain Hash</td>
      <td><a href="https://maps.google.com/?q=37.77,-122.43">Alamo Square</a></td>
      <td>GPH3 #1700</td>
    </tr>
    <tr>
      <td><a href="/runs/1236">1160</a></td>
      <td>Sunday 3/9/2026</td>
      <td>Muddy Buddy</td>
      <td>Lake Merritt</td>
      <td>EBH3 #1160: East Bay Sunday Funday</td>
    </tr>
    <tr>
      <td><a href="/runs/1237">562</a></td>
      <td>Thursday 3/13/2026</td>
      <td>Beer Hunter</td>
      <td><a href="https://maps.google.com/?q=37.35,-121.94">San Jose</a></td>
      <td>FHAC-U #562: Pub Crawl Edition</td>
    </tr>
    <tr>
      <td><a href="/runs/1238">292</a></td>
      <td>Saturday 3/15/2026</td>
      <td></td>
      <td></td>
      <td>Marin H3 #292</td>
    </tr>
  </tbody>
</table>
</body>
</html>
`;

describe("parseHarelineRows", () => {
  it("parses all rows from sample HTML", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows).toHaveLength(5);
  });

  it("extracts run numbers from first column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].runNumber).toBe(2302);
    expect(rows[1].runNumber).toBe(1700);
    expect(rows[2].runNumber).toBe(1160);
  });

  it("extracts date text from second column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].dateText).toBe("Monday 3/3/2026");
    expect(rows[1].dateText).toBe("Thursday 3/6/2026");
  });

  it("extracts hare from third column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].hare).toBe("Trail Blazer");
    expect(rows[1].hare).toBe("Captain Hash");
  });

  it("handles empty hare column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[4].hare).toBeUndefined();
  });

  it("extracts location text from fourth column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].locationText).toBe("Golden Gate Park");
    expect(rows[2].locationText).toBe("Lake Merritt");
  });

  it("extracts Google Maps URL from location cell", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].locationUrl).toBe("https://maps.google.com/?q=37.7694,-122.4862");
  });

  it("returns undefined locationUrl when no maps link", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[2].locationUrl).toBeUndefined();
  });

  it("extracts title from fifth column", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].title).toBe("SFH3 #2302: A Very Heated Rivalry");
    expect(rows[1].title).toBe("GPH3 #1700");
  });

  it("extracts detail page URL from run number link", () => {
    const rows = parseHarelineRows(SAMPLE_HTML);
    expect(rows[0].detailUrl).toBe("/runs/1234");
    expect(rows[1].detailUrl).toBe("/runs/1235");
  });

  it("returns empty array for HTML without a table", () => {
    const rows = parseHarelineRows("<html><body><p>No table</p></body></html>");
    expect(rows).toHaveLength(0);
  });

  it("skips rows with fewer than 5 cells", () => {
    const html = `
      <table>
        <thead><tr><th>A</th><th>B</th></tr></thead>
        <tbody><tr><td>1</td><td>2</td></tr></tbody>
      </table>
    `;
    const rows = parseHarelineRows(html);
    expect(rows).toHaveLength(0);
  });
});

describe("SFH3Adapter.fetch", () => {
  const KENNEL_PATTERNS: [string, string][] = [
    ["^SFH3", "SFH3"],
    ["^GPH3", "GPH3"],
    ["^EBH3", "EBH3"],
    ["^FHAC-U", "FHAC-U"],
    ["^Marin H3", "MarinH3"],
  ];

  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
      config: { kennelPatterns: KENNEL_PATTERNS, defaultKennelTag: "SFH3" },
    } as never);

    expect(result.events).toHaveLength(5);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.diagnosticContext).toMatchObject({
      rowsFound: 5,
      eventsParsed: 5,
    });

    // Verify first event (SFH3)
    const sfh3Event = result.events[0];
    expect(sfh3Event.date).toBe("2026-03-03");
    expect(sfh3Event.kennelTag).toBe("SFH3");
    expect(sfh3Event.runNumber).toBe(2302);
    expect(sfh3Event.title).toBe("A Very Heated Rivalry");
    expect(sfh3Event.hares).toBe("Trail Blazer");
    expect(sfh3Event.location).toBe("Golden Gate Park");
    expect(sfh3Event.locationUrl).toBe("https://maps.google.com/?q=37.7694,-122.4862");
    expect(sfh3Event.sourceUrl).toBe("https://www.sfh3.com/runs/1234");

    // Verify second event (GPH3)
    const gph3Event = result.events[1];
    expect(gph3Event.kennelTag).toBe("GPH3");
    expect(gph3Event.runNumber).toBe(1700);

    // Verify Marin H3 event (kennel pattern with space)
    const marinEvent = result.events[4];
    expect(marinEvent.kennelTag).toBe("MarinH3");
    expect(marinEvent.runNumber).toBe(292);

    vi.restoreAllMocks();
  });

  it("skips rows matching skipPatterns", async () => {
    const html = `
      <table><tbody>
        <tr>
          <td><a href="/runs/1">2302</a></td>
          <td>3/3/2026</td>
          <td>Trail Blazer</td>
          <td>Golden Gate Park</td>
          <td>SFH3 #2302: A Very Heated Rivalry</td>
        </tr>
        <tr>
          <td></td>
          <td>3/5/2026</td>
          <td></td>
          <td>SFH3 Clubhouse</td>
          <td>Hand Pump Workday</td>
        </tr>
        <tr>
          <td></td>
          <td>3/10/2026</td>
          <td></td>
          <td>SFH3 Clubhouse</td>
          <td>Workday - Spring Cleaning</td>
        </tr>
        <tr>
          <td><a href="/runs/2">1700</a></td>
          <td>3/6/2026</td>
          <td>Captain Hash</td>
          <td>Alamo Square</td>
          <td>GPH3 #1700</td>
        </tr>
      </tbody></table>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
      config: {
        kennelPatterns: KENNEL_PATTERNS,
        defaultKennelTag: "SFH3",
        skipPatterns: ["^Hand Pump", "^Workday"],
      },
    } as never);

    expect(result.events).toHaveLength(2);
    expect(result.events[0].kennelTag).toBe("SFH3");
    expect(result.events[1].kennelTag).toBe("GPH3");
    expect(result.diagnosticContext).toMatchObject({
      rowsFound: 4,
      eventsParsed: 2,
      skippedPattern: 2,
    });

    vi.restoreAllMocks();
  });

  it("emits all rows when no skipPatterns configured", async () => {
    const html = `
      <table><tbody>
        <tr>
          <td>1</td>
          <td>3/3/2026</td>
          <td></td>
          <td></td>
          <td>Hand Pump Workday</td>
        </tr>
      </tbody></table>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
      config: { defaultKennelTag: "SFH3" },
    } as never);

    // Without skipPatterns, the row is emitted (falls back to defaultKennelTag)
    expect(result.events).toHaveLength(1);
    expect(result.events[0].kennelTag).toBe("SFH3");
    expect(result.diagnosticContext).toMatchObject({ skippedPattern: 0 });

    vi.restoreAllMocks();
  });

  it("uses default kennel tag for unrecognized titles", async () => {
    const html = `
      <table><tbody>
        <tr>
          <td>1</td>
          <td>1/1/2026</td>
          <td>Hare</td>
          <td>Location</td>
          <td>Unknown Kennel #1</td>
        </tr>
      </tbody></table>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
      config: { kennelPatterns: KENNEL_PATTERNS, defaultKennelTag: "SFH3" },
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].kennelTag).toBe("SFH3");

    vi.restoreAllMocks();
  });

  it("records parse error for unparseable dates", async () => {
    const html = `
      <table><tbody>
        <tr>
          <td>1</td>
          <td>Bad Date</td>
          <td>Hare</td>
          <td>Location</td>
          <td>SFH3 #100</td>
        </tr>
      </tbody></table>
    `;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, { status: 200 }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
      config: { defaultKennelTag: "SFH3" },
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.parse).toHaveLength(1);
    expect(result.errorDetails!.parse![0].field).toBe("date");

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    const adapter = new SFH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.sfh3.com/runs?kennels=all",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });
});
