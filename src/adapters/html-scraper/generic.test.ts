import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import { parseEventRow, GenericHtmlAdapter, isGenericHtmlConfig } from "./generic";
import type { GenericHtmlConfig } from "./generic";
import type { Source } from "@/generated/prisma/client";

// Mock fetchHTMLPage
vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return {
    ...actual,
    fetchHTMLPage: vi.fn(),
  };
});

import { fetchHTMLPage } from "../utils";

const mockFetchHTMLPage = vi.mocked(fetchHTMLPage);

const TABLE_HTML = `
<html><body>
<table id="events">
  <thead><tr><th>Date</th><th>Hares</th><th>Location</th><th>Run #</th></tr></thead>
  <tbody>
    <tr>
      <td>March 15, 2026</td>
      <td>Salty Dog &amp; Beer Me</td>
      <td><a href="https://maps.google.com/q=bar">The Rusty Bucket</a></td>
      <td>1234</td>
    </tr>
    <tr>
      <td>March 22, 2026</td>
      <td>Hash Flash</td>
      <td>Central Park</td>
      <td>1235</td>
    </tr>
    <tr>
      <td></td>
      <td>TBD</td>
      <td>TBD</td>
      <td></td>
    </tr>
  </tbody>
</table>
</body></html>
`;

const BASE_CONFIG: GenericHtmlConfig = {
  containerSelector: "#events",
  rowSelector: "tbody tr",
  columns: {
    date: "td:nth-child(1)",
    hares: "td:nth-child(2)",
    location: "td:nth-child(3)",
    runNumber: "td:nth-child(4)",
  },
  defaultKennelTag: "DFWH3",
  dateLocale: "en-US",
};

describe("isGenericHtmlConfig", () => {
  it("returns true for valid config", () => {
    expect(isGenericHtmlConfig(BASE_CONFIG)).toBe(true);
  });

  it("returns false for null", () => {
    expect(isGenericHtmlConfig(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isGenericHtmlConfig(undefined)).toBe(false);
  });

  it("returns false when missing rowSelector", () => {
    expect(isGenericHtmlConfig({ containerSelector: "x" })).toBe(false);
  });

  it("returns false when columns is not an object", () => {
    expect(isGenericHtmlConfig({ containerSelector: "x", rowSelector: "x", columns: "bad" })).toBe(false);
  });
});

describe("parseEventRow", () => {
  const $ = cheerio.load(TABLE_HTML);
  const rows = $("#events tbody tr");

  it("parses a valid table row with all fields", () => {
    const event = parseEventRow($, $(rows[0]), BASE_CONFIG, "https://example.com");
    expect(event).toEqual({
      date: "2026-03-15",
      kennelTag: "DFWH3",
      title: undefined,
      hares: "Salty Dog & Beer Me",
      location: "The Rusty Bucket",
      locationUrl: "https://maps.google.com/q=bar",
      startTime: undefined,
      runNumber: 1234,
      sourceUrl: "https://example.com",
    });
  });

  it("parses a row without links", () => {
    const event = parseEventRow($, $(rows[1]), BASE_CONFIG, "https://example.com");
    expect(event).toMatchObject({
      date: "2026-03-22",
      hares: "Hash Flash",
      location: "Central Park",
      runNumber: 1235,
    });
    expect(event?.locationUrl).toBeUndefined();
  });

  it("returns null for a row with empty date", () => {
    const event = parseEventRow($, $(rows[2]), BASE_CONFIG, "https://example.com");
    expect(event).toBeNull();
  });

  it("uses defaultKennelTag when no kennelTag column configured", () => {
    const event = parseEventRow($, $(rows[0]), BASE_CONFIG, "https://example.com");
    expect(event?.kennelTag).toBe("DFWH3");
  });

  it("parses en-GB dates correctly", () => {
    const gbHtml = `<table><tr><td>15th March 2026</td></tr></table>`;
    const $gb = cheerio.load(gbHtml);
    const gbConfig: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)" },
      dateLocale: "en-GB",
    };
    const event = parseEventRow($gb, $gb("tr").first(), gbConfig, "https://example.com");
    expect(event?.date).toBe("2026-03-15");
  });

  it("extracts sourceUrl href when configured", () => {
    const html = `<table><tr><td>March 15, 2026</td><td><a href="https://example.com/event/1">Details</a></td></tr></table>`;
    const $src = cheerio.load(html);
    const config: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", sourceUrl: "td:nth-child(2)" },
    };
    const event = parseEventRow($src, $src("tr").first(), config, "https://fallback.com");
    expect(event?.sourceUrl).toBe("https://example.com/event/1");
  });

  it("parses startTime from 12-hour format", () => {
    const html = `<table><tr><td>March 15, 2026</td><td>6:30 PM</td></tr></table>`;
    const $t = cheerio.load(html);
    const config: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", startTime: "td:nth-child(2)" },
    };
    const event = parseEventRow($t, $t("tr").first(), config, "https://example.com");
    expect(event?.startTime).toBe("18:30");
  });

  it("parses startTime from HH:MM format", () => {
    const html = `<table><tr><td>March 15, 2026</td><td>19:00</td></tr></table>`;
    const $t = cheerio.load(html);
    const config: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", startTime: "td:nth-child(2)" },
    };
    const event = parseEventRow($t, $t("tr").first(), config, "https://example.com");
    expect(event?.startTime).toBe("19:00");
  });

  it("truncates location at UK postcode when locationTruncateAfter is set", () => {
    const html = `<table><tr>
      <td>25th March 2026</td>
      <td>The Regency, 22-24 Lower Church Road, Weston-super-Mare BS23 2AG. Try the Grove Park car park, Grove Road BS23 2AA, £2 after 6pm.</td>
    </tr></table>`;
    const $loc = cheerio.load(html);
    const config: GenericHtmlConfig = {
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", location: "td:nth-child(2)" },
      defaultKennelTag: "bogs",
      dateLocale: "en-GB",
      locationTruncateAfter: "uk-postcode",
    };
    const event = parseEventRow($loc, $loc("tr").first(), config, "https://example.com");
    expect(event?.location).toBe(
      "The Regency, 22-24 Lower Church Road, Weston-super-Mare BS23 2AG",
    );
  });

  it("does not truncate location when locationTruncateAfter is not set", () => {
    const fullLocation =
      "The Regency, 22-24 Lower Church Road, Weston-super-Mare BS23 2AG. Try the Grove Park car park, Grove Road BS23 2AA, £2 after 6pm.";
    const html = `<table><tr>
      <td>25th March 2026</td>
      <td>${fullLocation}</td>
    </tr></table>`;
    const $loc = cheerio.load(html);
    const config: GenericHtmlConfig = {
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", location: "td:nth-child(2)" },
      defaultKennelTag: "bogs",
      dateLocale: "en-GB",
    };
    const event = parseEventRow($loc, $loc("tr").first(), config, "https://example.com");
    expect(event?.location).toBe(fullLocation);
  });

  it("uses defaultStartTime when no per-event time exists", () => {
    const html = `<table><tr><td>March 15, 2026</td></tr></table>`;
    const $t = cheerio.load(html);
    const config: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)" },
      defaultStartTime: "19:15",
    };
    const event = parseEventRow($t, $t("tr").first(), config, "https://example.com");
    expect(event?.startTime).toBe("19:15");
  });

  it("prefers extracted startTime over defaultStartTime", () => {
    const html = `<table><tr><td>March 15, 2026</td><td>6:30 PM</td></tr></table>`;
    const $t = cheerio.load(html);
    const config: GenericHtmlConfig = {
      ...BASE_CONFIG,
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", startTime: "td:nth-child(2)" },
      defaultStartTime: "19:15",
    };
    const event = parseEventRow($t, $t("tr").first(), config, "https://example.com");
    expect(event?.startTime).toBe("18:30");
  });

  it("rejects absurdly large run numbers from date text in wrong column", () => {
    // "13 - 14 June 2026" stripped to digits "13142026" should be rejected
    const html = `<div class="c"><div class="r">
      <span class="rn">13 - 14 June 2026</span>
      <span class="d">March 28, 2026</span>
    </div></div>`;
    const $r = cheerio.load(html);
    const config: GenericHtmlConfig = {
      containerSelector: ".c",
      rowSelector: ".r",
      columns: { runNumber: ".rn", date: ".d" },
      defaultKennelTag: "test",
    };
    const result = parseEventRow($r, $r(".r").first(), config, "https://example.com");
    if (result) {
      expect(result.runNumber).toBeUndefined();
    }
  });

  it("accepts normal 4-digit run numbers", () => {
    const html = `<div class="c"><div class="r">
      <span class="rn">2206</span>
      <span class="d">March 23, 2026</span>
    </div></div>`;
    const $r = cheerio.load(html);
    const config: GenericHtmlConfig = {
      containerSelector: ".c",
      rowSelector: ".r",
      columns: { runNumber: ".rn", date: ".d" },
      defaultKennelTag: "test",
    };
    const result = parseEventRow($r, $r(".r").first(), config, "https://example.com");
    expect(result).toBeDefined();
    expect(result!.runNumber).toBe(2206);
  });

  it("passes forwardDate option to chronoParseDate", () => {
    const html = `<table><tr><td>March 28</td><td>Salty Dog</td><td>The Bar</td><td>1500</td></tr></table>`;
    const $f = cheerio.load(html);
    const configWithForward: GenericHtmlConfig = {
      containerSelector: "table",
      rowSelector: "tr",
      columns: { date: "td:nth-child(1)", hares: "td:nth-child(2)", location: "td:nth-child(3)", runNumber: "td:nth-child(4)" },
      defaultKennelTag: "test",
      forwardDate: true,
    };
    const event = parseEventRow($f, $f("tr").first(), configWithForward, "https://example.com");
    expect(event).toBeDefined();
    expect(event!.date).toMatch(/^\d{4}-03-28$/);
  });
});

describe("GenericHtmlAdapter", () => {
  const adapter = new GenericHtmlAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("HTML_SCRAPER");
  });

  it("extracts events from a table page", async () => {
    const $ = cheerio.load(TABLE_HTML);
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      html: TABLE_HTML,
      $,
      structureHash: "abc123",
      fetchDurationMs: 100,
    });

    const source = {
      id: "test-source",
      url: "https://example.com/events",
      config: BASE_CONFIG,
    } as unknown as Source;

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(2); // 3rd row has no date → skipped
    expect(result.events[0].date).toBe("2026-03-15");
    expect(result.events[0].hares).toBe("Salty Dog & Beer Me");
    expect(result.events[1].date).toBe("2026-03-22");
    expect(result.structureHash).toBe("abc123");
    expect(result.diagnosticContext?.rowsFound).toBe(3);
    expect(result.diagnosticContext?.eventsParsed).toBe(2);
  });

  it("returns error result when fetch fails", async () => {
    mockFetchHTMLPage.mockResolvedValue({
      ok: false,
      result: { events: [], errors: ["HTTP 404: Not Found"] },
    });

    const source = {
      id: "test-source",
      url: "https://example.com/events",
      config: BASE_CONFIG,
    } as unknown as Source;

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("HTTP 404: Not Found");
  });

  it("handles missing container gracefully (falls back to rowSelector)", async () => {
    const html = `<html><body><table><tbody><tr><td>March 15, 2026</td></tr></tbody></table></body></html>`;
    const $ = cheerio.load(html);
    mockFetchHTMLPage.mockResolvedValue({
      ok: true, html, $, structureHash: "x", fetchDurationMs: 50,
    });

    const source = {
      id: "test",
      url: "https://example.com",
      config: {
        ...BASE_CONFIG,
        containerSelector: "#nonexistent",
        rowSelector: "tbody tr",
        columns: { date: "td:nth-child(1)" },
      },
    } as unknown as Source;

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(1);
    expect(result.diagnosticContext?.containerFound).toBe(false);
  });

  it("selects only first table when containerSelector is table:first-of-type (CFH3 pattern)", async () => {
    const twoTableHtml = `<html><body>
      <h2>Upcumming trails</h2>
      <table>
        <tr><td>#515</td><td>March 21, 2026</td><td>Mis-Man</td></tr>
        <tr><td>#516</td><td>April 4, 2026</td><td>TBD</td></tr>
      </table>
      <h2>Receding hareline</h2>
      <table>
        <tr><td>#122</td><td>March 21</td><td>Prostate Rights</td></tr>
        <tr><td>#129</td><td>March 22</td><td>Cums Late</td></tr>
      </table>
    </body></html>`;
    const $ = cheerio.load(twoTableHtml);
    mockFetchHTMLPage.mockResolvedValue({
      ok: true, html: twoTableHtml, $, structureHash: "x", fetchDurationMs: 50,
    });

    const source = {
      id: "cfh3-test",
      url: "https://capefearh3.com/hare-line/",
      config: {
        defaultKennelTag: "CFH3",
        containerSelector: "table:first-of-type",
        rowSelector: "tr",
        columns: { runNumber: "td:nth-child(1)", date: "td:nth-child(2)", hares: "td:nth-child(3)" },
      },
    } as unknown as Source;

    const result = await adapter.fetch(source);
    // Should only get events from first table (upcoming), not past trails
    expect(result.events).toHaveLength(2);
    expect(result.events[0].runNumber).toBe(515);
    expect(result.events[0].date).toBe("2026-03-21");
    expect(result.events[1].runNumber).toBe(516);
  });

  it("filters past events when maxPastDays is configured", async () => {
    // Create HTML with one future date and one old date (30 days ago)
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 7);
    const pastDate = new Date(today);
    pastDate.setDate(pastDate.getDate() - 30);
    const fmtDate = (d: Date) =>
      `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()}, ${d.getFullYear()}`;

    const html = `<html><body><table id="events"><tbody>
      <tr><td>${fmtDate(futureDate)}</td><td>Future Hare</td><td>Bar</td><td>100</td></tr>
      <tr><td>${fmtDate(pastDate)}</td><td>Old Hare</td><td>Pub</td><td>99</td></tr>
    </tbody></table></body></html>`;
    const $ = cheerio.load(html);
    mockFetchHTMLPage.mockResolvedValue({
      ok: true, html, $, structureHash: "x", fetchDurationMs: 50,
    });

    const source = {
      id: "test",
      url: "https://example.com",
      config: { ...BASE_CONFIG, columns: { date: "td:nth-child(1)", hares: "td:nth-child(2)", location: "td:nth-child(3)", runNumber: "td:nth-child(4)" }, maxPastDays: 14 },
    } as unknown as Source;

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBe("Future Hare");
  });

  it("returns empty events when page has no matching rows", async () => {
    const html = `<html><body><div>No table here</div></body></html>`;
    const $ = cheerio.load(html);
    mockFetchHTMLPage.mockResolvedValue({
      ok: true, html, $, structureHash: "x", fetchDurationMs: 50,
    });

    const source = {
      id: "test",
      url: "https://example.com",
      config: BASE_CONFIG,
    } as unknown as Source;

    const result = await adapter.fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.diagnosticContext?.rowsFound).toBe(0);
  });
});
