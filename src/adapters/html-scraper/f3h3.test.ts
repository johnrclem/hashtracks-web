import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseHarelineRow, F3H3Adapter } from "./f3h3";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-f3h3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-f3h3",
    name: "F3H3 Website",
    url: "https://www.f3h3.net/",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
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
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

const SAMPLE_HTML = `
<html><body>
<table id="hareline" class="full">
  <tr>
    <td>Date</td><td>Run</td><td>Station</td><td>Venue</td><td>Hare(s)</td><td>Notes</td>
  </tr>
  <tr style="background-color: #ffffcc">
    <td>April 3rd</td><td>&nbsp;</td><td></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
  </tr>
  <tr>
    <td>April 10th</td><td>1058</td><td>Sendai</td><td>&nbsp;</td><td>Mismanagement</td>
    <td>15th Memorial Hash Pub Crawl (Joint Hash with Sendai H3)</td>
  </tr>
  <tr>
    <td>April 24th</td><td>1059</td><td>TBA</td><td>&nbsp;</td><td>Nada Johnny Tonight</td>
    <td>&nbsp;</td>
  </tr>
</table>
</body></html>
`;

describe("F3H3Adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseHarelineRow", () => {
    const sourceUrl = "https://www.f3h3.net/";
    const ref = new Date("2026-04-01");

    it("parses a standard row with run number, station, hares, and notes", () => {
      const cells = [
        "April 10th",
        "1058",
        "Sendai",
        "",
        "Mismanagement",
        "15th Memorial Hash Pub Crawl",
      ];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result).toMatchObject({
        date: "2026-04-10",
        kennelTags: ["f3h3"],
        title: "F3H3 #1058",
        runNumber: 1058,
        hares: "Mismanagement",
        location: "Sendai",
        startTime: "19:30",
        sourceUrl,
      });
      expect(result?.description).toContain("15th Memorial Hash Pub Crawl");
    });

    it("parses a row with TBA station (stripped as placeholder)", () => {
      const cells = [
        "April 24th",
        "1059",
        "TBA",
        "",
        "Nada Johnny Tonight",
        "",
      ];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result).toMatchObject({
        date: "2026-04-24",
        runNumber: 1059,
        hares: "Nada Johnny Tonight",
      });
      expect(result?.location).toBeUndefined();
    });

    it("skips off-week rows with no run number and no content", () => {
      const cells = ["April 3rd", "", "", "", "", ""];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result).toBeNull();
    });

    it("returns null for unparseable date", () => {
      const cells = ["TBD", "1060", "Shibuya", "", "SomeHare", ""];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result).toBeNull();
    });

    it("returns null for fewer than 6 cells", () => {
      const result = parseHarelineRow(["April 10th", "1058"], sourceUrl, ref);

      expect(result).toBeNull();
    });

    it("prefers venue over station for location when both present", () => {
      const cells = [
        "April 10th",
        "1058",
        "Shibuya Station",
        "Yoyogi Park",
        "TestHare",
        "",
      ];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result?.location).toBe("Yoyogi Park");
      expect(result?.description).toContain("Station: Shibuya Station");
    });

    // #959: when Venue cell is empty (or `&nbsp;` whitespace from cheerio), fall
    // back to Station for the location. Previously inconsistent for some rows.
    it("falls back to station when venue cell is empty/whitespace (#959)", () => {
      const cells = [
        "May 8th",
        "1060",
        "Ochanomizu御茶ノ水",
        "",
        "Milts In Your Mouth",
        "Chuo, Chuo-Sobu, and Marunouchi Lines",
      ];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result?.location).toBe("Ochanomizu御茶ノ水");
    });

    it("treats nbsp-only venue as empty and falls back to station (#959)", () => {
      const cells = [
        "May 8th",
        "1060",
        "Ikebukuro池袋",
        " ",
        "TestHare",
        "",
      ];

      const result = parseHarelineRow(cells, sourceUrl, ref);

      expect(result?.location).toBe("Ikebukuro池袋");
    });
  });

  describe("fetch()", () => {
    it("parses full HTML and returns events, skipping off-week rows", async () => {
      mockFetchResponse(SAMPLE_HTML);

      const adapter = new F3H3Adapter();
      const result = await adapter.fetch(makeSource());

      // 2 real events (row 2 = off-week skipped, rows 3 and 4 have content)
      expect(result.events.length).toBe(2);
      expect(result.events[0].runNumber).toBe(1058);
      expect(result.events[0].hares).toBe("Mismanagement");
      expect(result.events[1].runNumber).toBe(1059);
      expect(result.events[1].hares).toBe("Nada Johnny Tonight");
      expect(result.errors).toEqual([]);
    });

    it("returns fetch error on HTTP failure", async () => {
      mockedSafeFetch.mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        text: () => Promise.resolve(""),
        headers: new Headers(),
      } as Response);

      const adapter = new F3H3Adapter();
      const result = await adapter.fetch(makeSource());

      expect(result.events).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
