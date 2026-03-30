import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseHarelineRow, extractHares, RIH3Adapter } from "./rih3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-rih3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://rih3.com/hareline.html";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-rih3",
    name: "RIH3 Website Hareline",
    url: "https://rih3.com/hareline.html",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "weekly",
    scrapeDays: 90,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers(),
  } as Response);
}

// --- Fixtures based on real rih3.com/hareline.html ---

const HARE_SINGLE = `
<strong><span style="FONT-SIZE: large">Rusty</span></strong>
<br/><img border="0" src="Images/guinness.jpg" width="200" height="150"/><br/>
`;

const HARE_TWO_SPANS = `
<strong>
<span style="FONT-SIZE: large">tongue in rEar</span>
<br/><img border="0" src="Images/licking.gif" width="200" height="300"/><br/>
<span style="FONT-SIZE: large">and ProbonoR</span>
</strong><br><img border="0" src="Images/probonor.jpg" width="250" height="350"/>
`;

const HARE_AND_TEXT_NODE = `
<strong>
<span style="FONT-SIZE: large">Cracker Jackoff</span><br/>
<img border="0" src="Images/cjo.jpg" width="200" height="250"/><br/>
</strong>
<br/>and BJL<br/>
<img border="0" src="Images/spaceod.gif" width="200" height="250"/>
`;

const HARE_AMPERSAND = `
<strong>
<span style="FONT-SIZE: large">EtiClit </span>
<br/><img border="0" src="Images/shaken.gif" width="200" height="150"/><br/>
& Sister Sauna Snatch<br/>
<img border="0" src="Images/sauna.gif" width="150" height="250"/><br/></strong>
`;

const HARE_WITH_PROSE = `
<strong><span style="FONT-SIZE: large">Hairy Kirschner</span>
</strong><br/>
<img border="0" src="Images/men6.gif" width="150" height="160"/><br/>
<span style="FONT-SIZE: large">and Luxury Box</span></strong>
<br><img border="0" src="Images/lb2.jpg" width="200" height="150"/>
</strong><br/>
<p align="left"><span style="font-size: medium;"><a href="Songs/Favorites/Holeminer.txt"><span style="font-family: Arial; color: #cc0000;">Talking to WHO at last week's Hash</span></a></span></p>
`;

const HARE_TBD = `<strong><span style="FONT-SIZE: large">TBD</span></strong>`;

const DIRECTION_WITH_MAPS = `
<br/><p><strong></strong></p>
<h2><strong>Sandy Point Beach Hash<br/>But it's the First Hash of Spring</strong></h2>
<strong>
After that 4+ miles monsoon slog, starting from the small dirt lot on Smith Rd.
<br/><br/>
<a href="https://www.google.com/maps/place/Bradford+Ave,+Portsmouth,+RI+02871/" target="new">
<font color="#cc0000">Park Here. Just a short bit from the dog park</font></a>
<br/><br/>
<p align="left"><a href="Songs/Favorites/santaclauseiscuming.txt">
<span style="font-family: Arial; color: #cc0000;">His Song of the Week: Santa Claus</span></a></p>
<br/>
<p align="left"><span style="font-size: small;"><span style="font-family: Arial; color: #cc0000;">
<a href="https://www.facebook.com/groups/120140164667510" target="new">See the RIH3 facebook Page for updates</a>
</span></span></p>
</strong>
`;

const DIRECTION_NO_MAPS = `
<p><h2>This Hash will bring tears to your eyes</h2>
<br/><br/><br/>
Basket says, "Check out the Receding Hareline..."
<br/><br/>
<p><a href="Songs/Favorites/coldwinter.txt">Her Song of the Week</a></p>
<br/><br/>
<p><a href="https://www.facebook.com/groups/120140164667510">See the RIH3 facebook Page for updates</a></p>
`;

// --- Tests ---

describe("extractHares", () => {
  it("extracts single hare", () => {
    expect(extractHares(HARE_SINGLE)).toBe("Rusty");
  });

  it("extracts two hares from spans with 'and' prefix", () => {
    expect(extractHares(HARE_TWO_SPANS)).toBe("tongue in rEar, ProbonoR");
  });

  it("extracts hare from 'and' text node outside strong", () => {
    expect(extractHares(HARE_AND_TEXT_NODE)).toBe("Cracker Jackoff, BJL");
  });

  it("extracts hare with '&' separator", () => {
    expect(extractHares(HARE_AMPERSAND)).toBe("EtiClit, Sister Sauna Snatch");
  });

  it("excludes prose/song links from hare names", () => {
    const result = extractHares(HARE_WITH_PROSE);
    expect(result).toBe("Hairy Kirschner, Luxury Box");
    expect(result).not.toContain("Talking");
    expect(result).not.toContain("Holeminer");
  });

  it("returns undefined for TBD placeholder", () => {
    expect(extractHares(HARE_TBD)).toBeUndefined();
  });

  it("returns undefined for empty HTML", () => {
    expect(extractHares("")).toBeUndefined();
  });
});

describe("parseHarelineRow", () => {
  it("parses standard event with all fields", () => {
    const cells = ["Mon April 21", "6:30 PM", "2043"];
    const result = parseHarelineRow(
      cells,
      HARE_TWO_SPANS,
      DIRECTION_WITH_MAPS,
      SOURCE_URL,
    );

    expect(result).toMatchObject({
      date: "2026-04-21",
      kennelTag: "rih3",
      runNumber: 2043,
      startTime: "18:30",
      hares: "tongue in rEar, ProbonoR",
      sourceUrl: SOURCE_URL,
    });
    expect(result?.title).toContain("Sandy Point Beach Hash");
    expect(result?.locationUrl).toContain("google.com/maps");
    // Navigation instructions stripped: "Park Here. Just a short bit from the dog park" → "dog park"
    expect(result?.location).toBe("dog park");
  });

  it("strips navigation instructions from Maps link text", () => {
    const dirHtml = `
      <h2><strong>Test Run</strong></h2>
      <a href="https://www.google.com/maps/place/Melville+Park">
        <font color="#cc0000">Park Here. Just a short bit from the dog park at Melville Park, Portsmouth, RI</font>
      </a>
    `;
    const cells = ["Mon April 28", "6:30 PM", "2044"];
    const result = parseHarelineRow(cells, HARE_SINGLE, dirHtml, SOURCE_URL);
    expect(result?.location).toBe("dog park at Melville Park, Portsmouth, RI");
  });

  it("normalizes H2 title with line breaks", () => {
    const cells = ["Mon March 23", "6:30 PM", "2091"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      DIRECTION_WITH_MAPS,
      SOURCE_URL,
    );

    // H2 has <br/> between two lines — should become single space
    expect(result?.title).toBe(
      "Sandy Point Beach Hash But it's the First Hash of Spring",
    );
  });

  it("extracts Google Maps URL as locationUrl", () => {
    const cells = ["Mon April 21", "6:30 PM", "2043"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      DIRECTION_WITH_MAPS,
      SOURCE_URL,
    );

    expect(result?.locationUrl).toContain(
      "google.com/maps/place/Bradford+Ave",
    );
  });

  it("handles event without Google Maps link", () => {
    // Pin date so forwardDate doesn't push "March 30" to next year
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 2, 25, 12)));
    try {
      const cells = ["Mon March 30", "6:30 PM", "2092"];
      const result = parseHarelineRow(
        cells,
        HARE_SINGLE,
        DIRECTION_NO_MAPS,
        SOURCE_URL,
      );

      expect(result).toMatchObject({
        date: "2026-03-30",
        runNumber: 2092,
        title: "This Hash will bring tears to your eyes",
      });
      expect(result?.locationUrl).toBeUndefined();
      expect(result?.location).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to run number title when no H2", () => {
    const cells = ["Mon April 6", "6:30 PM", "2093"];
    const result = parseHarelineRow(cells, HARE_SINGLE, "", SOURCE_URL);

    expect(result?.title).toBe("RIH3 #2093");
  });

  it("falls back to generic title when no H2 and no run number", () => {
    const cells = ["Mon April 6", "6:30 PM", ""];
    const result = parseHarelineRow(cells, HARE_SINGLE, "", SOURCE_URL);

    expect(result?.title).toBe("RIH3 Monday Trail");
  });

  it("strips day-of-week prefix from time", () => {
    const cells = ["Mon March 23", "Mon 6:30 PM", "2091"];
    const result = parseHarelineRow(cells, HARE_SINGLE, "", SOURCE_URL);

    expect(result?.startTime).toBe("18:30");
  });

  it("defaults to 18:30 for unparseable time", () => {
    const cells = ["Mon March 23", "NOON'ish", "2091"];
    const result = parseHarelineRow(cells, HARE_SINGLE, "", SOURCE_URL);

    expect(result?.startTime).toBe("18:30");
  });

  it("returns null for missing date", () => {
    const cells = ["", "6:30 PM", "2091"];
    expect(
      parseHarelineRow(cells, HARE_SINGLE, "", SOURCE_URL),
    ).toBeNull();
  });

  it("returns null for insufficient columns", () => {
    expect(parseHarelineRow(["Mon April 6"], "", "", SOURCE_URL)).toBeNull();
  });

  it("preserves Facebook link as text with URL in description", () => {
    const cells = ["Mon April 21", "6:30 PM", "2043"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      DIRECTION_WITH_MAPS,
      SOURCE_URL,
    );

    expect(result?.description).toContain("facebook.com/groups");
    expect(result?.description).toContain("See the RIH3 facebook Page");
    expect(result?.description).not.toContain("Song of the Week");
    expect(result?.description).toContain("monsoon slog");
  });

  it("strips song links from description", () => {
    const cells = ["Mon April 21", "6:30 PM", "2043"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      DIRECTION_WITH_MAPS,
      SOURCE_URL,
    );

    expect(result?.description).not.toContain("Santa Claus");
    expect(result?.description).not.toContain("Song of the Week");
  });

  it("strips leading comma from description (Bug #3)", () => {
    const directionWithComma = `
<p>,</p>
<h2>This Hash will bring tears to your eyes</h2>
<br/><br/><br/>
Basket says, "Check out the Receding Hareline..."
<br/><br/>
<p><a href="https://www.facebook.com/groups/120140164667510">See the RIH3 facebook Page</a></p>
`;
    const cells = ["Mon March 30", "6:30 PM", "2092"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      directionWithComma,
      SOURCE_URL,
    );

    expect(result?.description).not.toMatch(/^[,\s]/);
    expect(result?.description).toContain("Basket says");
  });

  it("resolves same-day date to current year, not next year (Bug #1)", () => {
    // Simulate scrape running at 2:30 PM on March 23, 2026
    const midDayRef = new Date(2026, 2, 23, 14, 30, 0);
    const cells = ["Mon March 23", "6:30 PM", "2091"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      "",
      SOURCE_URL,
      midDayRef,
    );

    // Should still be 2026, NOT 2027
    expect(result?.date).toBe("2026-03-23");
  });

  it("resolves yesterday's date to current year, not next year", () => {
    // Simulate scrape running the next day (March 24 at 10:53 AM)
    const nextDayRef = new Date(2026, 2, 24, 10, 53, 0);
    const cells = ["Mon March 23", "6:30 PM", "2091"];
    const result = parseHarelineRow(
      cells,
      HARE_SINGLE,
      "",
      SOURCE_URL,
      nextDayRef,
    );

    // Should still be 2026, NOT 2027
    expect(result?.date).toBe("2026-03-23");
  });
});

describe("RIH3Adapter", () => {
  const adapter = new RIH3Adapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("parses multiple rows from a hareline table", async () => {
    const html = `<html><body>
      <table border="5">
        <tbody>
          <tr>
            <td><span>Date:</span></td>
            <td><span>Time:</span></td>
            <td><span>Run</span></td>
            <td><span>Hare:</span></td>
            <td><span>Directions:</span></td>
          </tr>
          <tr>
            <td>Mon April 21</td>
            <td>6:30 PM</td>
            <td>2043</td>
            <td><strong><span style="FONT-SIZE: large">Rusty</span></strong>
                <br/><img src="Images/guinness.jpg"/></td>
            <td><h2>Spring Trail</h2>Meet at the park.
                <p><a href="https://www.facebook.com/groups/120140164667510">FB</a></p></td>
          </tr>
          <tr>
            <td>Mon. Aug 25</td>
            <td>6:30 PM</td>
            <td>2061</td>
            <td><strong><span style="FONT-SIZE: large">Hairy</span></strong>
                <br/><img src="Images/men6.gif"/><br/>
                and Luxury Box<br/><img src="Images/lb2.jpg"/></td>
            <td><h2>Summer Hash</h2>
                <a href="https://www.google.com/maps/place/Lincoln+RI" target="new">
                <font color="#cc0000">Park at John St</font></a></td>
          </tr>
        </tbody>
      </table>
      <table border="5"><tbody><tr><td>HARELINE DOGHOUSE</td></tr></tbody></table>
    </body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      date: "2026-04-21",
      kennelTag: "rih3",
      runNumber: 2043,
      hares: "Rusty",
      title: "Spring Trail",
      startTime: "18:30",
    });
    expect(result.events[1]).toMatchObject({
      date: "2026-08-25",
      runNumber: 2061,
      hares: "Hairy, Luxury Box",
      title: "Summer Hash",
      locationUrl: expect.stringContaining("google.com/maps"),
    });
  });

  it("skips commented-out rows", async () => {
    const html = `<html><body>
      <table border="5">
        <tbody>
          <tr><td>Date:</td><td>Time:</td><td>Run</td><td>Hare:</td><td>Directions:</td></tr>
          <!-- <tr><td>Sat Feb 8</td><td>NOON</td><td>2033</td><td>Old Hare</td><td>Old trail</td></tr> --->
          <tr>
            <td>Mon April 21</td><td>6:30 PM</td><td>2043</td>
            <td><strong>Rusty</strong></td>
            <td><h2>Active Trail</h2></td>
          </tr>
        </tbody>
      </table>
    </body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(2043);
  });

  it("handles page with no events", async () => {
    const html = `<html><body><table border="5"><tbody>
      <tr><td>Date:</td><td>Time:</td><td>Run</td><td>Hare:</td><td>Directions:</td></tr>
    </tbody></table></body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  it("returns fetch error on HTTP failure", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);

    const result = await adapter.fetch(makeSource());

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("includes structureHash and diagnosticContext", async () => {
    const html = `<html><body>
      <table border="5"><tbody>
        <tr><td>Date:</td><td>Time:</td><td>Run</td><td>Hare:</td><td>Directions:</td></tr>
        <tr><td>Mon April 21</td><td>6:30 PM</td><td>2043</td>
            <td><strong>Rusty</strong></td><td><h2>Trail</h2></td></tr>
      </tbody></table>
    </body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    expect(result.structureHash).toBe("mock-hash-rih3");
    expect(result.diagnosticContext).toHaveProperty("rowsFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed");
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");
  });

  it("ignores second table (Doghouse)", async () => {
    const html = `<html><body>
      <table border="5"><tbody>
        <tr><td>Date:</td><td>Time:</td><td>Run</td><td>Hare:</td><td>Directions:</td></tr>
        <tr><td>Mon April 21</td><td>6:30 PM</td><td>2043</td>
            <td><strong>Rusty</strong></td><td><h2>Trail</h2></td></tr>
      </tbody></table>
      <table border="5"><tbody>
        <tr><td colspan="3">HARELINE DOGHOUSE:</td></tr>
        <tr><td>&nbsp;</td><td>Wee Balls</td><td>Moved to Texas</td></tr>
      </tbody></table>
    </body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource());

    // Only 1 event from the first table, no doghouse entries
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(2043);
  });
});
