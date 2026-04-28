import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseSumoDate, parseHarelineRow, SumoH3Adapter } from "./sumo-h3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-sumo"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-sumo",
    name: "Sumo H3 Website",
    url: "https://sumoh3.gotothehash.net/",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
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
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

describe("SumoH3Adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseSumoDate", () => {
    const ref = new Date("2026-04-01");

    it("parses standard DD Mon format", () => {
      expect(parseSumoDate("05 Apr", ref)).toBe("2026-04-05");
    });

    it("parses single-digit day", () => {
      expect(parseSumoDate("3 May", ref)).toBe("2026-05-03");
    });

    it("takes first date from multi-day format", () => {
      expect(parseSumoDate("11 Apr 12 Apr", ref)).toBe("2026-04-11");
    });

    it("returns null for empty string", () => {
      expect(parseSumoDate("", ref)).toBeNull();
    });

    it("returns null for unparseable text", () => {
      expect(parseSumoDate("TBD", ref)).toBeNull();
    });

    it("uses current year when no reference date", () => {
      const result = parseSumoDate("07 Jun");
      expect(result).toMatch(/^\d{4}-06-07$/);
    });
  });

  describe("parseHarelineRow", () => {
    const sourceUrl = "https://sumoh3.gotothehash.net/";
    const ref = new Date("2026-04-01");

    it("parses a standard row with all fields", () => {
      const cells = [
        "1038(click here)",
        "05 Apr ",
        "East ex. Central Community Center Square",
        "Higashimurayama",
        "Seibu-Kokubunji / Seibu-Shinjuku etc",
        "Khuming Rouge",
      ];

      const result = parseHarelineRow(cells, 1038, sourceUrl, ref);

      expect(result).toMatchObject({
        date: "2026-04-05",
        kennelTags: ["sumo-h3"],
        title: "Sumo H3 #1038",
        runNumber: 1038,
        hares: "Khuming Rouge",
        location: "Higashimurayama",
        startTime: "14:00",
        sourceUrl,
      });
      expect(result?.description).toBe(
        "East ex. Central Community Center Square",
      );
    });

    it("parses multi-day event using first date", () => {
      const cells = [
        "1039(click here)",
        "11 Apr 12 Apr",
        "Overnighter! Joint to Sendai Hash",
        "Sendai(Miyagi)",
        "JR etc.",
        "Good on top and No Stand",
      ];

      const result = parseHarelineRow(cells, 1039, sourceUrl, ref);

      expect(result).toMatchObject({
        date: "2026-04-11",
        runNumber: 1039,
        hares: "Good on top and No Stand",
        location: "Sendai(Miyagi)",
      });
    });

    it("skips rows with HARE NEEDED and no station/hare info", () => {
      const cells = [
        "1040(click here)",
        "19 Apr ",
        "HARE NEEDED!!",
        "",
        "",
        "",
      ];

      const result = parseHarelineRow(cells, 1040, sourceUrl, ref);

      expect(result).toBeNull();
    });

    it("keeps rows with TBA description but valid hare", () => {
      const cells = [
        "1041(click here)",
        "26 Apr ",
        "TBA",
        "",
        "",
        "Burning Bush",
      ];

      const result = parseHarelineRow(cells, 1041, sourceUrl, ref);

      expect(result).toMatchObject({
        date: "2026-04-26",
        runNumber: 1041,
        hares: "Burning Bush",
      });
      expect(result?.description).toBeUndefined();
    });

    it("returns null for unparseable date", () => {
      const cells = ["1050", "TBD", "some event", "station", "line", "hare"];

      const result = parseHarelineRow(cells, 1050, sourceUrl, ref);

      expect(result).toBeNull();
    });

    it("returns null for fewer than 6 cells", () => {
      const result = parseHarelineRow(
        ["1038", "05 Apr"],
        1038,
        sourceUrl,
        ref,
      );

      expect(result).toBeNull();
    });
  });

  describe("fetch()", () => {
    const SAMPLE_HTML = `
<html><body>
<table>
<tr><th>Run</th><th>Date</th><th>Event Description</th><th>Station</th><th>Line</th><th>Hare</th></tr>
<tr>
<td><a href="/events/1038/" title="1038">1038</a><br /><div>(click here)</div></td>
<td>05 Apr </td>
<td><p>East ex. Central Community Center Square</p></td>
<td>Higashimurayama</td>
<td>Seibu-Kokubunji</td>
<td>Khuming Rouge</td>
</tr>
<tr>
<td><a href="/events/1040/" title="1040">1040</a><br /><div>(click here)</div></td>
<td>19 Apr </td>
<td><p>HARE NEEDED!!</p></td>
<td></td>
<td></td>
<td></td>
</tr>
<tr>
<td><a href="/events/1041/" title="1041">1041</a><br /><div>(click here)</div></td>
<td>26 Apr </td>
<td><p>TBA</p></td>
<td></td>
<td></td>
<td>Burning Bush</td>
</tr>
</table>
</body></html>
`;

    it("parses full HTML and returns events, skipping HARE NEEDED rows", async () => {
      mockFetchResponse(SAMPLE_HTML);

      const adapter = new SumoH3Adapter();
      const result = await adapter.fetch(makeSource());

      // Row 1 (1038) = real event, Row 2 (1040) = HARE NEEDED skipped, Row 3 (1041) = has hare
      expect(result.events.length).toBe(2);
      expect(result.events[0].runNumber).toBe(1038);
      expect(result.events[0].location).toBe("Higashimurayama");
      expect(result.events[1].runNumber).toBe(1041);
      expect(result.events[1].hares).toBe("Burning Bush");
      expect(result.errors).toEqual([]);
    });

    it("returns fetch error on HTTP failure", async () => {
      mockedSafeFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as Response);

      const adapter = new SumoH3Adapter();
      const result = await adapter.fetch(makeSource());

      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("handles empty table gracefully", async () => {
      mockFetchResponse(`
        <html><body>
        <table><tr><th>Run</th><th>Date</th><th>Event Description</th><th>Station</th><th>Line</th><th>Hare</th></tr></table>
        </body></html>
      `);

      const adapter = new SumoH3Adapter();
      const result = await adapter.fetch(makeSource());

      expect(result.events).toEqual([]);
      expect(result.errors).toEqual([]);
    });
  });
});
