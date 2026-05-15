import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import {
  MiteriHarelineAdapter,
  parseMiteriRow,
  parseGutenbergTable,
  parseSiteOriginGrid,
} from "./miteri-hareline";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-miteri"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-miteri",
    name: "Miteri Test Source",
    url: "https://example.co.nz/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: { kennelTag: "garden-city-h3" },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function mockFetch(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

describe("parseMiteriRow", () => {
  const refDate = new Date("2026-05-15T00:00:00Z");

  it("parses a normal weekly row", () => {
    const row = parseMiteriRow(
      { runText: "2358", dateText: "2 June", hareText: "Tabasco & Hoover", locationText: "Hagley Park" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://gardencityhash.co.nz/" },
    );
    expect(row).not.toBeNull();
    expect(row?.date).toBe("2026-06-02");
    expect(row?.runNumber).toBe(2358);
    // normalizeHaresField only splits on commas, so the ampersand-joined string is preserved.
    expect(row?.hares).toBe("Tabasco & Hoover");
    expect(row?.location).toBe("Hagley Park");
    expect(row?.kennelTags).toEqual(["garden-city-h3"]);
  });

  it("collapses multi-day ranges to the start date", () => {
    const row = parseMiteriRow(
      { runText: "2356", dateText: "22-24 May", hareText: "Hurunui Hotel", locationText: "Weekend Away" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(row?.date).toBe("2026-05-22");
  });

  it("handles en-dash and em-dash range separators", () => {
    const row = parseMiteriRow(
      { runText: "2356", dateText: "22 – 24 May", hareText: "Hares", locationText: "Loc" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(row?.date).toBe("2026-05-22");
  });

  it("returns null for empty date cell", () => {
    expect(parseMiteriRow(
      { runText: "?", dateText: "", hareText: "", locationText: "" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://x" },
    )).toBeNull();
    expect(parseMiteriRow(
      { runText: "?", dateText: " ", hareText: "", locationText: "" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://x" },
    )).toBeNull();
  });

  it("treats TBC / ?? hares + location as undefined (atomic-bundle preservation)", () => {
    const row = parseMiteriRow(
      { runText: "2360", dateText: "16 June", hareText: "TBC", locationText: "??" },
      { kennelTag: "garden-city-h3", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(row?.hares).toBeUndefined();
    expect(row?.location).toBeUndefined();
  });

  it("sorts hares deterministically (fingerprint stability)", () => {
    const a = parseMiteriRow(
      { runText: "1", dateText: "2 June", hareText: "Zebra, Alpha, Mike", locationText: "" },
      { kennelTag: "k", referenceDate: refDate, sourceUrl: "https://x" },
    );
    const b = parseMiteriRow(
      { runText: "1", dateText: "2 June", hareText: "Mike, Alpha, Zebra", locationText: "" },
      { kennelTag: "k", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(a?.hares).toBe(b?.hares);
    expect(a?.hares).toBe("Alpha, Mike, Zebra");
  });
});

describe("parseSiteOriginGrid (GCH3 layout)", () => {
  // Minimal facsimile of the Garden City Hash homepage structure.
  const gchHtml = `<!DOCTYPE html><html><body>
    <div class="panel-grid">
      <div class="panel-grid-cell">
        <div class="textwidget">
          <p><strong>Run:</strong></p>
          <p>2356</p>
          <p>2357</p>
          <p>2358</p>
        </div>
      </div>
      <div class="panel-grid-cell">
        <div class="textwidget">
          <p><strong>Date:</strong></p>
          <p>22-24 May</p>
          <p>26 May</p>
          <p>2 June</p>
        </div>
      </div>
      <div class="panel-grid-cell">
        <div class="textwidget">
          <p><strong>Hares:</strong></p>
          <p>Hurunui Hotel</p>
          <p>TBC</p>
          <p>Tabasco</p>
        </div>
      </div>
      <div class="panel-grid-cell">
        <div class="textwidget">
          <p><strong>Location:</strong></p>
          <p>Weekend Away</p>
          <p>??</p>
          <p>Hagley Park</p>
        </div>
      </div>
    </div>
  </body></html>`;

  it("extracts 3 columnar rows from the SiteOrigin grid", () => {
    const $ = cheerio.load(gchHtml);
    const rows = parseSiteOriginGrid($);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({
      runText: "2356",
      dateText: "22-24 May",
      hareText: "Hurunui Hotel",
      locationText: "Weekend Away",
    });
    expect(rows[2]).toEqual({
      runText: "2358",
      dateText: "2 June",
      hareText: "Tabasco",
      locationText: "Hagley Park",
    });
  });

  it("ignores unrelated panel-grids without Run + Date headers", () => {
    const html = `<div class="panel-grid">
      <div class="panel-grid-cell"><div class="textwidget"><p><strong>Contact:</strong></p><p>Foo</p></div></div>
      <div class="panel-grid-cell"><div class="textwidget"><p><strong>Map:</strong></p><p>Bar</p></div></div>
    </div>`;
    const $ = cheerio.load(html);
    expect(parseSiteOriginGrid($)).toEqual([]);
  });
});

describe("parseGutenbergTable (CHH3 layout)", () => {
  const chhHtml = `<!DOCTYPE html><html><body>
    <figure class="wp-block-table">
      <table>
        <tbody>
          <tr><td><strong>Run #</strong></td><td><strong>Date:</strong></td><td><strong>Hare:</strong></td><td><strong>Address:</strong></td></tr>
          <tr><td>2050</td><td>18 May</td><td>Spanner</td><td>123 Riccarton Rd, Christchurch</td></tr>
          <tr><td></td><td></td><td></td><td></td></tr>
        </tbody>
      </table>
    </figure>
  </body></html>`;

  it("parses a Gutenberg table by header labels", () => {
    const $ = cheerio.load(chhHtml);
    const rows = parseGutenbergTable($);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({
      runText: "2050",
      dateText: "18 May",
      hareText: "Spanner",
      locationText: "123 Riccarton Rd, Christchurch",
    });
    // empty body row preserved (cleanCellText filters in parseMiteriRow)
    expect(rows[1].dateText).toBe("");
  });

  it("returns empty when no wp-block-table is present", () => {
    const $ = cheerio.load("<div>No table here.</div>");
    expect(parseGutenbergTable($)).toEqual([]);
  });
});

describe("MiteriHarelineAdapter.fetch (GCH3-style page)", () => {
  it("returns ordered RawEventData for visible runs and skips placeholders", async () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="panel-grid">
        <div class="panel-grid-cell"><div class="textwidget">
          <p><strong>Run:</strong></p><p>2356</p><p>2358</p>
        </div></div>
        <div class="panel-grid-cell"><div class="textwidget">
          <p><strong>Date:</strong></p><p>22-24 May 2026</p><p>2 June 2026</p>
        </div></div>
        <div class="panel-grid-cell"><div class="textwidget">
          <p><strong>Hares:</strong></p><p>Hurunui Hotel</p><p>Tabasco &amp; Hoover</p>
        </div></div>
        <div class="panel-grid-cell"><div class="textwidget">
          <p><strong>Location:</strong></p><p>Weekend Away</p><p>Hagley Park</p>
        </div></div>
      </div>
    </body></html>`;
    mockFetch(html);

    const adapter = new MiteriHarelineAdapter();
    const result = await adapter.fetch(makeSource({ url: "https://gardencityhash.co.nz/" }), { days: 365 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(2);
    expect(result.events[0].date).toBe("2026-05-22");
    expect(result.events[0].runNumber).toBe(2356);
    expect(result.events[1].date).toBe("2026-06-02");
    expect(result.events[1].runNumber).toBe(2358);
    expect(result.diagnosticContext?.layout).toBe("siteorigin");
  });

  it("returns config error when kennelTag is missing", async () => {
    const src = makeSource({ config: {} });
    const adapter = new MiteriHarelineAdapter();
    const result = await adapter.fetch(src);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/kennelTag/);
  });
});
