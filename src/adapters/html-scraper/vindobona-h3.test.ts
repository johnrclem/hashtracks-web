import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  parseFutureRow,
  parseScheduleNextRun,
  VindobonaH3Adapter,
} from "./vindobona-h3";

// Mock safeFetch (used by fetchHTMLPage) + structureHash.
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-vh3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

/** Real futureruns.html table (verbatim shape, representative rows). */
const FUTURERUNS_HTML = `<html><head>
<table id="futuretable">
<thead><tr><th>Date</th><th>Hash#</th><th>Hares</th><th>Comments</th></tr></thead>
<tbody>
<tr><td class="auto-style1">2026-06-08</td><td>Hash #2363</td><td>Miss Piss</td><td></td></tr>
<tr><td class="auto-style1">2026-06-22</td><td>Hash #2365</td><td>Marie Tamponette &  S. Energy</td><td>Wiener Neudorf</td></tr>
<tr><td class="auto-style1">2026-07-06</td><td>Hash #2367</td><td></td><td></td></tr>
<tr><td class="auto-style1">2026-08-01</td><td>FMH #30?</td><td>Casting Couch</td><td>Summer afternoon Full Moon run</td></tr>
<tr><td class="auto-style1">2026-12-13</td><td>Hash #23??</td><td>Oh Fardolena & Whoppa</td><td>Finlandia run</td></tr>
</tbody>
</table>
</head></html>`;

/** Real schedule.html: a "Hash Taxi" contact table (must be ignored) + the
 * single next-run runinfo table (rowspan img) + a Google My-Maps link. */
const SCHEDULE_HTML = `<html><body>
<table class="runinfo">
<tr><td colspan="5"><b>For lifts to the runs (Hash Taxi), please contact :-</b></td></tr>
<tr><td><b>Name</b></td><td><b>Work Phone</b></td><td><b>Home Phone</b></td><td><b>Handy</b></td><td><b>Pick-up</b></td></tr>
<tr><td>Lord Glo-Balls</td><td>Retired</td><td>+43 2215 3178</td><td>+43 664 415 4225</td><td>U1 Kaisermühlen</td></tr>
</table>
<a id="hash2363"></a>
<table class="runinfo">
<tr><td rowspan="2"><img src="x.png"></td><td><b>Date</b></td><td><b>Time</b></td><td><b>Run No.</b></td><td><b>Hares</b></td><td><b>Location</b></td></tr>
<tr><td><strong>2026-06-08</strong></td><td>18:30</td><td>#2363</td><td>Miss Piss</td><td>Kaiserzeit Würstelstand, Augartenbrücke, 1020 Wien (or nearby)<br>GPS coordinates: N48.21903, E16.37094</td></tr>
</table>
<o><strong>Google Maps: </strong><a href="https://www.google.com/maps/d/u/1/view?mid=1PPpF9NPHzI9Oh&usp=sharing">Click for Map</a></o>
</body></html>`;

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-vh3",
    name: "Vindobona H3 Hareline",
    url: "https://viennahash.org/plans/futureruns.html",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: {
      upcomingOnly: true,
      scheduleUrl: "https://viennahash.org/schedule.html",
    },
    lastScrapeAt: null,
    lastSuccessAt: null,
    healthStatus: "UNKNOWN",
    enabled: true,
    baselineResetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

function errorResponse(): Response {
  return {
    ok: false,
    status: 500,
    statusText: "Server Error",
    text: () => Promise.resolve(""),
    headers: new Headers(),
  } as Response;
}

/** Route futureruns → hareline fixture, schedule → detail fixture. */
function mockBothPages() {
  mockedSafeFetch.mockImplementation((url: string | URL) =>
    Promise.resolve(
      String(url).includes("futureruns")
        ? htmlResponse(FUTURERUNS_HTML)
        : htmlResponse(SCHEDULE_HTML),
    ),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("parseFutureRow", () => {
  it.each([
    [
      "Hash # routes to vindobona-h3 with a clean run number",
      ["2026-06-08", "Hash #2363", "Miss Piss", ""],
      { date: "2026-06-08", kennel: "vindobona-h3", runNumber: 2363, hares: "Miss Piss" },
    ],
    [
      "FMH # routes to vienna-fmh3 and rejects the trailing-? run number",
      ["2026-08-01", "FMH #30?", "Casting Couch", "Full Moon run"],
      { date: "2026-08-01", kennel: "vienna-fmh3", runNumber: undefined, hares: "Casting Couch" },
    ],
    [
      "Hash #23?? keeps the dated event but drops the unfinalized run number",
      ["2026-12-13", "Hash #23??", "Oh Fardolena & Whoppa", "Finlandia run"],
      { date: "2026-12-13", kennel: "vindobona-h3", runNumber: undefined, hares: "Oh Fardolena & Whoppa" },
    ],
    [
      "blank hares cell maps to undefined",
      ["2026-07-06", "Hash #2367", "", ""],
      { date: "2026-07-06", kennel: "vindobona-h3", runNumber: 2367, hares: undefined },
    ],
  ])("%s", (_label, cells, expected) => {
    const ev = parseFutureRow(cells);
    expect(ev).not.toBeNull();
    expect(ev?.date).toBe(expected.date);
    expect(ev?.kennelTags).toEqual([expected.kennel]);
    expect(ev?.runNumber).toBe(expected.runNumber);
    expect(ev?.hares).toBe(expected.hares);
    // Titles are always synthesized downstream — never set by the adapter.
    expect(ev?.title).toBeUndefined();
  });

  it("collapses doubled whitespace in the hares cell", () => {
    const ev = parseFutureRow(["2026-06-22", "Hash #2365", "Marie Tamponette &  S. Energy", "Wiener Neudorf"]);
    expect(ev?.hares).toBe("Marie Tamponette & S. Energy");
  });

  it("routes the Comments column to description, never to location", () => {
    const ev = parseFutureRow(["2026-06-22", "Hash #2365", "X", "Wiener Neudorf"]);
    expect(ev?.description).toBe("Wiener Neudorf");
    expect(ev?.location).toBeUndefined();
  });

  it.each([
    ["empty row (header with no <td>)", []],
    ["non-ISO date", ["8 June 2026", "Hash #2363", "X", ""]],
    ["unknown run-label prefix", ["2026-06-08", "Notice: no run", "", ""]],
  ])("returns null for %s", (_label, cells) => {
    expect(parseFutureRow(cells)).toBeNull();
  });
});

describe("parseScheduleNextRun", () => {
  it("extracts the next-run detail, ignoring the Hash Taxi table", () => {
    const $ = cheerio.load(SCHEDULE_HTML);
    const info = parseScheduleNextRun($);
    expect(info).not.toBeNull();
    expect(info?.runNumber).toBe(2363);
    expect(info?.startTime).toBe("18:30");
    expect(info?.location).toBe("Kaiserzeit Würstelstand, Augartenbrücke, 1020 Wien");
    expect(info?.latitude).toBeCloseTo(48.21903, 5);
    expect(info?.longitude).toBeCloseTo(16.37094, 5);
    expect(info?.locationUrl).toContain("google.com/maps");
  });

  it("returns null when there is no run-number row", () => {
    const $ = cheerio.load("<html><body><table><tr><td>No runs</td></tr></table></body></html>");
    expect(parseScheduleNextRun($)).toBeNull();
  });

  it("reads a prefixed run-number cell (e.g. 'Hash #2363')", () => {
    const $ = cheerio.load(
      `<html><body><table class="runinfo">
        <tr><td><strong>2026-06-08</strong></td><td>18:30</td><td>Hash #2363</td><td>Miss Piss</td>
        <td>Venue GPS coordinates: N48.21903, E16.37094</td></tr>
      </table></body></html>`,
    );
    expect(parseScheduleNextRun($)?.runNumber).toBe(2363);
  });

  it("drops out-of-range GPS coords but keeps the rest of the detail", () => {
    const $ = cheerio.load(
      `<html><body><table class="runinfo">
        <tr><td><strong>2026-06-08</strong></td><td>18:30</td><td>#2363</td><td>Miss Piss</td>
        <td>Some Venue GPS coordinates: N480.5, E16.37094</td></tr>
      </table></body></html>`,
    );
    const info = parseScheduleNextRun($);
    expect(info?.runNumber).toBe(2363);
    expect(info?.startTime).toBe("18:30");
    expect(info?.location).toBe("Some Venue");
    expect(info?.latitude).toBeUndefined();
    expect(info?.longitude).toBeUndefined();
  });
});

describe("VindobonaH3Adapter.fetch", () => {
  it("parses the hareline, routes both kennels, and enriches the next run", async () => {
    mockBothPages();
    const result = await new VindobonaH3Adapter().fetch(makeSource(), { days: 100000 });

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(5);
    // Sorted ascending by date.
    expect(result.events.map((e) => e.date)).toEqual([
      "2026-06-08",
      "2026-06-22",
      "2026-07-06",
      "2026-08-01",
      "2026-12-13",
    ]);

    const fmh = result.events.filter((e) => e.kennelTags.includes("vienna-fmh3"));
    expect(fmh).toHaveLength(1);
    expect(fmh[0].date).toBe("2026-08-01");
    expect(fmh[0].runNumber).toBeUndefined(); // "FMH #30?"

    // Next-run enrichment merged into #2363 by run number.
    const next = result.events.find((e) => e.runNumber === 2363);
    expect(next?.startTime).toBe("18:30");
    expect(next?.location).toContain("Kaiserzeit Würstelstand");
    expect(next?.latitude).toBeCloseTo(48.21903, 5);
    expect(next?.longitude).toBeCloseTo(16.37094, 5);

    // A non-enriched run keeps no fabricated start time.
    const plain = result.events.find((e) => e.runNumber === 2367);
    expect(plain?.startTime).toBeUndefined();
  });

  it("emits a fail-loud zero-guard error when the hareline parses empty", async () => {
    mockedSafeFetch.mockImplementation((url: string | URL) =>
      Promise.resolve(
        String(url).includes("futureruns")
          ? htmlResponse("<html><body><table></table></body></html>")
          : htmlResponse(SCHEDULE_HTML),
      ),
    );
    const result = await new VindobonaH3Adapter().fetch(makeSource(), { days: 100000 });
    expect(result.events).toHaveLength(0);
    expect(result.errors.join(" ")).toMatch(/0 events/i);
  });

  it("fires the Hash# prefix-drift guard when only FMH rows parse", async () => {
    const allFmh = `<html><head><table id="futuretable"><tbody>
      <tr><td>2026-08-01</td><td>FMH #30?</td><td>Casting Couch</td><td></td></tr>
      <tr><td>2026-09-01</td><td>FMH #31?</td><td>Someone</td><td></td></tr>
    </tbody></table></head></html>`;
    mockedSafeFetch.mockImplementation((url: string | URL) =>
      Promise.resolve(String(url).includes("futureruns") ? htmlResponse(allFmh) : htmlResponse(SCHEDULE_HTML)),
    );
    const result = await new VindobonaH3Adapter().fetch(makeSource(), { days: 100000 });
    expect(result.events).toHaveLength(2); // events still emit
    expect(result.events.every((e) => e.kennelTags.includes("vienna-fmh3"))).toBe(true);
    expect(result.errors.join(" ")).toMatch(/0 vindobona-h3 events/i);
  });

  it("reports a fetch error (and no events) when the hareline page fails", async () => {
    mockedSafeFetch.mockImplementation((url: string | URL) =>
      Promise.resolve(String(url).includes("futureruns") ? errorResponse() : htmlResponse(SCHEDULE_HTML)),
    );
    const result = await new VindobonaH3Adapter().fetch(makeSource(), { days: 100000 });
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.fetch?.length).toBeGreaterThan(0);
  });

  it("still returns hareline events when the schedule enrichment page fails", async () => {
    mockedSafeFetch.mockImplementation((url: string | URL) =>
      Promise.resolve(String(url).includes("futureruns") ? htmlResponse(FUTURERUNS_HTML) : errorResponse()),
    );
    const result = await new VindobonaH3Adapter().fetch(makeSource(), { days: 100000 });
    // Enrichment failure must NOT suppress reconcile (no error pushed) or drop events.
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(5);
    const next = result.events.find((e) => e.runNumber === 2363);
    expect(next?.startTime).toBeUndefined(); // un-enriched
  });
});
