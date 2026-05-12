import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  KampongH3Adapter,
  parseKampongNextRun,
  parseKampongArchiveTable,
} from "./kampong-h3";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-kampong"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const FIXTURE_HTML = `<!DOCTYPE html>
<html><body>
<h1>Next Run<br>Run 297</h1>
<h2>Date: Saturday, 16<sup>th</sup> May 2026<br>Run starts 5:30PM</h2>
<h2>Hares: Horny Pony &amp; Olive Oyl &amp; Shoeless &amp; Durian Dog</h2>
<h2>Run site: Holland Green Linear Park</h2>
<h2>On On: <a href="https://www.facebook.com/forture.seafood/">Forture Seafood Steam Boat</a> a.k.a. The Red Lantern</h2>
<h2><a id="Hareline">Kampong HHH Hare Line</a></h2>
<table>
<tr><th>Run</th><th>Date and Details</th></tr>
<tr><td>1</td><td>18 September 1999 - STRAIGHT SPOUT &amp; CAT WOMAN, Lorong Sesuai</td>
<tr><td>2</td><td>16 October 1999 - PONTIANAK &amp; TOO WET, Rifle Range Road</td>
<tr><td>150</td><td>20 February 2013 - Some mid-archive row</td>
<tr><td>295</td><td>21 March 2026 - AGM Run hared by Pink Pussy and Silky Pussy at URA carpark</td>
<tr><td>296</td><td>18 April 2026 - Fawlty Towers and Fawlty Bush at Vigilante Drive car park A</td>
<tr><td>297</td><td>16 May 2026 - Horny Pony &amp; Olive Oyl &amp; Shoeless &amp; Durian Dog</td>
<tr><td>298</td><td>20 June 2026</td>
<tr><td>299</td><td>18 July 2026 - Wet Knickers' birthday run</td>
<tr><td>300</td><td>15 August 2026 - 300th Run</td>
<tr><td>301</td><td>19 September 2026 - Gypsy &amp; Zipp</td>
<tr><td>302</td><td>17 October 2026  - Up Yours &amp; Bumpher</td>
<tr><td>303</td><td>21 November 2026 - Tight Arse &amp; Cat Woman</td>
</table>
</body></html>`;

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-kampong",
    name: "Kampong H3 Website",
    url: "https://kampong.hash.org.sg",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 90,
    config: {},
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as Source;
}

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue(
    new Response(html, {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/html" },
    }),
  );
}

describe("parseKampongNextRun", () => {
  it("parses the canonical Next Run block (singular Hare label)", () => {
    // Pipe-separated chunks mirror what `collectNextRunHeaderText` produces
    // in production (one h2 per chunk).
    const text = `Next Run Run 296 | Date: Saturday, 18 th April 2026 Run starts 5:30PM | Hare: Fawlty Towers | Run site: T.B.A.`;
    const out = parseKampongNextRun(text);
    expect(out.runNumber).toBe(296);
    expect(out.date).toBe("2026-04-18");
    expect(out.startTime).toBe("17:30");
    expect(out.hares).toBe("Fawlty Towers");
    expect(out.location).toBeUndefined(); // T.B.A. filtered
  });

  it("parses the plural Hares: label (regression for live layout)", () => {
    const text = `Next Run Run 297 | Date: Saturday, 16th May 2026 Run starts 5:30PM | Hares: Horny Pony & Olive Oyl & Shoeless & Durian Dog | Run site: Holland Green Linear Park | On On: Forture Seafood Steam Boat`;
    const out = parseKampongNextRun(text);
    expect(out.runNumber).toBe(297);
    expect(out.date).toBe("2026-05-16");
    expect(out.hares).toBe("Horny Pony & Olive Oyl & Shoeless & Durian Dog");
    expect(out.location).toBe("Holland Green Linear Park");
    expect(out.onAfter).toBe("Forture Seafood Steam Boat");
  });

  it("captures a real run site when not TBA", () => {
    const text = `Next Run Run 297 | Date: Saturday, 16 May 2026 Run starts 5:30PM | Hare: Sloppy Joe | Run site: Bukit Timah Nature Reserve`;
    const out = parseKampongNextRun(text);
    expect(out.location).toBe("Bukit Timah Nature Reserve");
  });

  it("handles times without colon (e.g. 5PM)", () => {
    const text = `Next Run Run 298 | Date: Saturday, 20 June 2026 Run starts 5PM | Hare: Streaker`;
    const out = parseKampongNextRun(text);
    expect(out.startTime).toBe("17:00");
  });

  it("handles ordinal suffixes on day numbers", () => {
    expect(parseKampongNextRun("Date: Saturday, 1st January 2027").date).toBe("2027-01-01");
    expect(parseKampongNextRun("Date: Saturday, 22nd March 2026").date).toBe("2026-03-22");
    expect(parseKampongNextRun("Date: Saturday, 23rd April 2026").date).toBe("2026-04-23");
  });

  it("returns empty fields when text is unparseable", () => {
    const out = parseKampongNextRun("Just some random text without any structured fields");
    expect(out.runNumber).toBeUndefined();
    expect(out.date).toBeUndefined();
    expect(out.startTime).toBeUndefined();
  });
});

describe("parseKampongArchiveTable", () => {
  const result = parseKampongArchiveTable(cheerio.load(FIXTURE_HTML));
  const rows = result.rows;

  it("parses every data row, skipping the header", () => {
    // 12 data rows in the fixture (1, 2, 150, 295, 296, 297, 298, 299, 300, 301, 302, 303)
    expect(rows).toHaveLength(12);
    expect(rows[0]).toEqual({
      runNumber: 1,
      date: "1999-09-18",
      detailsRaw: "STRAIGHT SPOUT & CAT WOMAN, Lorong Sesuai",
    });
  });

  it("captures a bare-date forward row with no details", () => {
    const run298 = rows.find((r) => r.runNumber === 298);
    expect(run298).toEqual({
      runNumber: 298,
      date: "2026-06-20",
      detailsRaw: undefined,
    });
  });

  it("captures milestone / themed forward rows", () => {
    const run300 = rows.find((r) => r.runNumber === 300);
    expect(run300?.detailsRaw).toBe("300th Run");
  });

  it("tolerates double-space variants in the date cell", () => {
    const run302 = rows.find((r) => r.runNumber === 302);
    expect(run302?.date).toBe("2026-10-17");
    expect(run302?.detailsRaw).toBe("Up Yours & Bumpher");
  });

  it("decodes HTML entities in detailsRaw via Cheerio .text()", () => {
    const run1 = rows.find((r) => r.runNumber === 1);
    expect(run1?.detailsRaw).toContain("STRAIGHT SPOUT & CAT WOMAN");
  });

  it("reports rows with malformed dates instead of silently dropping them", () => {
    // Fixture: numeric runNumber, but date cell starts with "February" (no day).
    const html = `<html><body>
<h2><a id="Hareline">Hare Line</a></h2>
<table>
<tr><th>Run</th><th>Date</th></tr>
<tr><td>18</td><td>February 2001 - SOIXANTE NEUF and PONTIANAK</td></tr>
<tr><td>19</td><td>17 March 2001 - real row</td></tr>
</table>
</body></html>`;
    const out = parseKampongArchiveTable(cheerio.load(html));
    expect(out.rows.map((r) => r.runNumber)).toEqual([19]);
    expect(out.skipped).toEqual([
      { runNumber: 18, cellText: "February 2001 - SOIXANTE NEUF and PONTIANAK", reason: "no-leading-date" },
    ]);
  });
});

describe("KampongH3Adapter.fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-11T00:00:00Z"));
    mockedSafeFetch.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps forward emissions to the source's scrapeDays horizon", async () => {
    mockFetchResponse(FIXTURE_HTML);
    const adapter = new KampongH3Adapter();
    // scrapeDays=90, today=2026-05-11 → horizon=2026-08-09. Runs 297, 298, 299
    // fall inside; Run 300 (Aug 15) and beyond fall outside.
    const result = await adapter.fetch(makeSource({ scrapeDays: 90 }));

    expect(result.events.map((e) => e.runNumber)).toEqual([297, 298, 299]);
    expect(result.errors).toEqual([]);

    // Past archive rows must never appear, regardless of window.
    for (const e of result.events) {
      expect(e.kennelTags).toEqual(["kampong-h3"]);
    }

    // Run 297 must come from the Next Run block (carries hares + location + on-after).
    const run297 = result.events.find((e) => e.runNumber === 297);
    expect(run297?.hares).toBe("Horny Pony & Olive Oyl & Shoeless & Durian Dog");
    expect(run297?.location).toBe("Holland Green Linear Park");
    expect(run297?.description).toContain("Forture Seafood Steam Boat");
    expect(run297?.startTime).toBe("17:30");

    // A forward archive row keeps the kennel-default time and routes details to description.
    const run299 = result.events.find((e) => e.runNumber === 299);
    expect(run299?.startTime).toBe("17:30");
    expect(run299?.description).toBe("Wet Knickers' birthday run");
    expect(run299?.hares).toBeUndefined();
    expect(run299?.location).toBeUndefined();
  });

  it("honors options.days override of source.scrapeDays", async () => {
    mockFetchResponse(FIXTURE_HTML);
    const adapter = new KampongH3Adapter();
    // 250-day window puts horizon at 2027-01-16, capturing every forward row.
    const result = await adapter.fetch(makeSource({ scrapeDays: 30 }), { days: 250 });
    expect(result.events).toHaveLength(7);
    expect(result.events.map((e) => e.runNumber)).toEqual([297, 298, 299, 300, 301, 302, 303]);
  });

  it("surfaces archive rows with malformed dates as scrape errors", async () => {
    const html = FIXTURE_HTML.replace(
      `<tr><td>299</td><td>18 July 2026 - Wet Knickers' birthday run</td>`,
      `<tr><td>299</td><td>NOT A DATE - Wet Knickers' birthday run</td>`,
    );
    mockFetchResponse(html);
    const adapter = new KampongH3Adapter();
    const result = await adapter.fetch(makeSource({ scrapeDays: 365 }));
    expect(result.errors.some((e) => e.includes("Archive row 299 skipped"))).toBe(true);
  });

  it("reports skipped rows whose runNumber lies between the Next Run overlay and the lowest archive entry", async () => {
    // Construct a fixture where:
    //   - Next Run (overlay) is Run 297 — in-window.
    //   - Run 298 is malformed (NOT A DATE) — skipped.
    //   - Run 299 is in-window via the archive (so archive's lowest entry is 299).
    // Without the post-overlay reportSkipped fix the cutoff would be 299 and
    // Run 298's skip wouldn't surface, masking real parser drift.
    const html = FIXTURE_HTML.replace(
      `<tr><td>298</td><td>20 June 2026</td>`,
      `<tr><td>298</td><td>NOT A DATE - Some June run</td>`,
    );
    mockFetchResponse(html);
    const adapter = new KampongH3Adapter();
    const result = await adapter.fetch(makeSource({ scrapeDays: 365 }));
    expect(result.events.map((e) => e.runNumber)).toEqual([297, 299, 300, 301, 302, 303]);
    expect(result.errors.some((e) => e.includes("Archive row 298 skipped"))).toBe(true);
  });

  it("reports an error and emits no events when the Next Run block is missing AND no forward rows are present", async () => {
    // Strip the Next Run header and every future archive row.
    const stripped = FIXTURE_HTML
      .replace(/<h1>Next Run[\s\S]*?<\/h2>/, "") // remove h1 only — simplest signal
      .replace(/<h2>Date:[\s\S]*?<h2><a id="Hareline">/, '<h2><a id="Hareline">');
    // Also remove all 2026-and-later forward rows.
    const noForward = stripped.replace(/<tr><td>29[7-9]<\/td>[\s\S]*?<\/table>/, "</table>");
    mockFetchResponse(noForward);
    const adapter = new KampongH3Adapter();
    const result = await adapter.fetch(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
