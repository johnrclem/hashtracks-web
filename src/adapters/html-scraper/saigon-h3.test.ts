import * as cheerio from "cheerio";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  applyThisWeeksRun,
  parseThisWeeksRun, parseHarelineRow, parseIsoDate, parseRunsArchive, SaigonH3Adapter } from "./saigon-h3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-saigon"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://saigonhashers.com/hareline";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-saigon",
    name: "Saigon H3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { upcomingOnly: true },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

// ISO date relative to "now" so the window-filter test never ages out of
// buildDateWindow(90). Far-past (1990) / far-future (2099) rows stay static.
function relativeIso(daysFromNow: number): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// 6-column row helper: numbers | Date | Name/Occasion | Hares | A-Site | On-On
function row(
  numbers: string,
  date: string,
  occasion: string,
  hares: string,
  hrefs: (string | undefined)[] = [],
) {
  const cells = [numbers, date, occasion, hares, "", ""];
  const hrefArr = [hrefs[0], hrefs[1], hrefs[2], hrefs[3], hrefs[4], hrefs[5]];
  return { cells, hrefs: hrefArr };
}

describe("This Week's Run panel (#2791)", () => {
  const panel = cheerio.load(`<div class="container this-weeks-run-container"><h2>This Week's Run</h2>
    <div class="container hash-newsletter"><h3> Run #1854: The Ultimate Cat Lai Temple Run </h3>
    <p> This week, we brave the murky Cat Lai waters. </p>
    <h5> 🐇 Hares: Three Shitty Tits, Forgettable Fuck &amp; Team Jack Off </h5>
    <h5> 🗓️ Sun, Nov 8th, 2026 </h5><h5> ⏰ Time and location: </h5>
    <ul><li> 13:30 - Bus pick up at Caravelle Hotel: <a href="https://maps.app.goo.gl/6N2nBAJDTMp3YTUE9">Caravelle Hotel</a> </li>
    <li> 15:00 - Run starts at A point: <a href="https://maps.app.goo.gl/xz39WsFmrid27NCu6">Nhà hàng Sông Quê Phước Khánh</a> </li></ul></div></div>`);

  it("reads the name, full hares, date and A-site", () => {
    expect(parseThisWeeksRun(panel)).toEqual({
      runNumber: 1854,
      date: "2026-11-08",
      details: {
        title: "The Ultimate Cat Lai Temple Run",
        hares: "Three Shitty Tits, Forgettable Fuck & Team Jack Off",
        location: "Nhà hàng Sông Quê Phước Khánh",
        locationUrl: "https://maps.app.goo.gl/xz39WsFmrid27NCu6",
        description: "This week, we brave the murky Cat Lai waters.",
      },
    });
  });

  it("overlays the matching row and adds the run when the table has moved past it", () => {
    const block = parseThisWeeksRun(panel)!;
    const row = { date: "2026-11-08", kennelTags: ["saigon-h3"], runNumber: 1854, hares: "FF,3ST& Co", startTime: "13:30" };
    const matching = [{ ...row }];
    applyThisWeeksRun(matching, block, "https://saigonhashers.com/hareline");
    expect(matching[0].hares).toBe("Three Shitty Tits, Forgettable Fuck & Team Jack Off");
    expect(matching[0].startTime).toBe("13:30");

    const passed: typeof matching = [];
    applyThisWeeksRun(passed, block, "https://saigonhashers.com/hareline");
    expect(passed[0]).toMatchObject({ runNumber: 1854, date: "2026-11-08", startTime: "13:30" });
  });

  it("keeps the table's hares when the panel only has a placeholder", () => {
    const events = [{ date: "2026-11-08", kennelTags: ["saigon-h3"], runNumber: 1854, hares: "FF,3ST& Co" }];
    applyThisWeeksRun(events, { runNumber: 1854, date: "2026-11-08", details: { hares: null } }, "https://saigonhashers.com/hareline");
    expect(events[0].hares).toBe("FF,3ST& Co");
  });

  it("is null without a numbered panel", () => {
    expect(parseThisWeeksRun(cheerio.load("<div></div>"))).toBeNull();
  });
});

describe("parseIsoDate", () => {
  it("parses a year-bearing ISO date to UTC-noon YYYY-MM-DD", () => {
    expect(parseIsoDate("2026-06-21")).toBe("2026-06-21");
  });
  it("rejects an overflow date (2026-02-31)", () => {
    expect(parseIsoDate("2026-02-31")).toBeNull();
  });
  it("rejects a non-ISO date", () => {
    expect(parseIsoDate("21/06/2026")).toBeNull();
    expect(parseIsoDate("Sunday 21 June 2026")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
  });
});

describe("SaigonH3Adapter.parseHarelineRow", () => {
  it("drops the 'Bus Trip/City Run' run-type so merge synthesizes the title", () => {
    const { cells, hrefs } = row("1834", "2026-06-21", "Bus Trip/City Run", "Hares Needed!");
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-06-21");
    expect(event!.runNumber).toBe(1834);
    expect(event!.title).toBeUndefined();
    expect(event!.hares).toBeNull(); // "Hares Needed!" placeholder cleared
    expect(event!.kennelTags[0]).toBe("saigon-h3");
    expect(event!.startTime).toBe("13:30"); // fixed Sunday bus departure
  });

  it("drops the run-type even with whitespace around the slash", () => {
    const { cells, hrefs } = row("1840", "2026-08-02", "Bus Trip / City Run", "Rocky & Co");
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event!.title).toBeUndefined();
    expect(event!.hares).toBe("Rocky & Co"); // real hare kept verbatim incl "& Co"
  });

  it("drops comma-separated run-type tokens and keeps the occasion (#2532)", () => {
    const a = row("1858", "2026-12-06", "Bus Trip,City Run", "PIYB & Co");
    expect(parseHarelineRow(a.cells, a.hrefs, SOURCE_URL)!.title).toBeUndefined();
    const b = row("1857", "2026-11-29", "City Run,St Andrew’s Day", "BAP,CAL & Co");
    expect(parseHarelineRow(b.cells, b.hrefs, SOURCE_URL)!.title).toBe("St Andrew’s Day");
  });

  it("keeps a real occasion/theme as the title", () => {
    const { cells, hrefs } = row("1837", "2026-07-12", "William of Orange Run", "Paddy Fag & Co");
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event!.title).toBe("William of Orange Run");
    expect(event!.hares).toBe("Paddy Fag & Co");
  });

  it("keeps the birthday-run theme", () => {
    const { cells, hrefs } = row(
      "1844",
      "2026-08-30",
      "Saigon H3 36th Birthday Run",
      "One at a Time & Co",
    );
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event!.title).toBe("Saigon H3 36th Birthday Run");
  });

  it("captures an A-Site Google Maps shortlink as locationUrl", () => {
    const { cells, hrefs } = row("1834", "2026-06-21", "Bus Trip/City Run", "Hares Needed!", [
      undefined,
      undefined,
      undefined,
      undefined,
      "https://maps.app.goo.gl/5yCXbbKa4yVwH5Th7",
      undefined,
    ]);
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/5yCXbbKa4yVwH5Th7");
  });

  it("ignores a non-Maps href in the A-Site column", () => {
    const { cells, hrefs } = row("1834", "2026-06-21", "Bus Trip/City Run", "Hares Needed!", [
      undefined,
      undefined,
      undefined,
      undefined,
      "https://example.com/not-a-map",
      undefined,
    ]);
    const event = parseHarelineRow(cells, hrefs, SOURCE_URL);
    expect(event!.locationUrl).toBeUndefined();
  });

  it("returns null for a non-run / header row", () => {
    expect(parseHarelineRow(["numbers", "Date", "Name", "Hares", "", ""], [], SOURCE_URL)).toBeNull();
  });

  it("returns null for a numbered row with an unparseable date", () => {
    const { cells, hrefs } = row("1840", "not-a-date", "Bus Trip/City Run", "Hares Needed!");
    expect(parseHarelineRow(cells, hrefs, SOURCE_URL)).toBeNull();
  });
});

describe("SaigonH3Adapter.fetch", () => {
  let adapter: SaigonH3Adapter;

  beforeEach(() => {
    adapter = new SaigonH3Adapter();
    vi.clearAllMocks();
  });

  it("parses the hareline table and filters the date window", async () => {
    const near = relativeIso(7);
    const html = `<html><body>
<table>
  <thead><tr><th>numbers</th><th>Date</th><th>Name/Occasion</th><th>Hares</th><th>A-Site</th><th>On-On</th></tr></thead>
  <tbody>
    <tr><td>9999</td><td>2099-11-29</td><td>Bus Trip/City Run</td><td>Hares Needed!</td><td></td><td></td></tr>
    <tr><td>1837</td><td>${near}</td><td>William of Orange Run</td><td>Paddy Fag &amp; Co</td><td></td><td></td></tr>
    <tr><td>100</td><td>1990-08-26</td><td>Bus Trip/City Run</td><td>Old Hare</td><td></td><td></td></tr>
  </tbody>
</table>
</body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource(), { days: 90 });

    expect(result.events.find((e) => e.date === "2099-11-29")).toBeUndefined();
    expect(result.events.find((e) => e.date === "1990-08-26")).toBeUndefined();
    const current = result.events.find((e) => e.date === near);
    expect(current).toBeDefined();
    expect(current!.title).toBe("William of Orange Run");
    expect(current!.hares).toBe("Paddy Fag & Co");
    expect(current!.runNumber).toBe(1837);
    expect(result.errors).toHaveLength(0);
  });

  it("fails loud (errors[]) when the table parses to zero rows", async () => {
    const html = `<html><body><table>
  <thead><tr><th>numbers</th><th>Date</th><th>Name/Occasion</th><th>Hares</th><th>A-Site</th><th>On-On</th></tr></thead>
  <tbody></tbody>
</table></body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("no upcoming runs"))).toBe(true);
  });

  it("fails loud per-run when a numbered row has a broken date", async () => {
    const html = `<html><body><table>
  <thead><tr><th>numbers</th><th>Date</th><th>Name/Occasion</th><th>Hares</th><th>A-Site</th><th>On-On</th></tr></thead>
  <tbody>
    <tr><td>1841</td><td>broken-date</td><td>Bus Trip/City Run</td><td>Hares Needed!</td><td></td><td></td></tr>
  </tbody>
</table></body></html>`;
    mockFetchResponse(html);

    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.errors.some((e) => e.includes("could not parse run row"))).toBe(true);
    expect(result.errorDetails?.parse?.length).toBeGreaterThan(0);
  });
});

describe("parseRunsArchive (/runs history backfill)", () => {
  // The /runs archive carries an extra "Pack Size" column (col 3) so Hares is
  // col 4 / A-Site col 5 — distinct from the hareline layout. Subsequent tables
  // on the page are per-run "Hash Name / Hare" detail panels and must be ignored.
  const html = `<html><body>
<table>
  <thead><tr><th>numbers</th><th>Date</th><th>Name/Occasion</th><th>Pack Size</th><th>Hares</th><th>A-Site</th><th>On-On</th></tr></thead>
  <tbody>
    <tr><td>1833</td><td>2026-06-14</td><td>Bus Trip</td><td>42</td><td>Cock-a-Leeky &amp; Co</td><td><a href="https://maps.app.goo.gl/abc123">Start</a></td><td></td></tr>
    <tr><td>1820</td><td>2026-03-15</td><td>Saigon H3 Anniversary Run</td><td>55</td><td>Hares Needed!</td><td></td><td></td></tr>
    <tr><td>bad</td><td>2026-01-01</td><td>Decorative</td><td></td><td></td><td></td><td></td></tr>
  </tbody>
</table>
<table>
  <thead><tr><th>Hash Name</th><th>Hare</th></tr></thead>
  <tbody><tr><td>Detail Run</td><td>Some Hare</td></tr></tbody>
</table>
</body></html>`;

  it("parses only the first table and maps the Pack-Size-offset columns", () => {
    const events = parseRunsArchive(html, "https://saigonhashers.com/runs");
    // 2 valid run rows; the "bad" run-number row and the detail table are ignored.
    expect(events).toHaveLength(2);

    const e1833 = events.find((e) => e.runNumber === 1833)!;
    expect(e1833.date).toBe("2026-06-14");
    expect(e1833.title).toBeUndefined(); // "Bus Trip" run-type dropped
    expect(e1833.hares).toBe("Cock-a-Leeky & Co"); // col 4, not the Pack Size col 3
    expect(e1833.locationUrl).toBe("https://maps.app.goo.gl/abc123"); // A-Site col 5, absolute
    expect(e1833.kennelTags[0]).toBe("saigon-h3");
    expect(e1833.startTime).toBe("13:30"); // fixed departure on archive rows too

    const e1820 = events.find((e) => e.runNumber === 1820)!;
    expect(e1820.title).toBe("Saigon H3 Anniversary Run"); // real theme kept
    expect(e1820.hares).toBeNull(); // "Hares Needed!" cleared
  });

  it("resolves a protocol-relative A-Site Maps link to an absolute URL", () => {
    const protoRelHtml = `<html><body><table>
  <thead><tr><th>numbers</th><th>Date</th><th>Name/Occasion</th><th>Pack Size</th><th>Hares</th><th>A-Site</th><th>On-On</th></tr></thead>
  <tbody>
    <tr><td>1800</td><td>2026-01-04</td><td>Bus Trip</td><td>30</td><td>Hare</td><td><a href="//maps.app.goo.gl/relrel">Start</a></td><td></td></tr>
  </tbody>
</table></body></html>`;
    const events = parseRunsArchive(protoRelHtml, "https://saigonhashers.com/runs");
    expect(events[0].locationUrl).toBe("https://maps.app.goo.gl/relrel");
  });
});
