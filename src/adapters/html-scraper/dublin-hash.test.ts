import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseHarelineRow, DublinHashAdapter, stripTruncatedPostalFragment } from "./dublin-hash";

// Mock safeFetch (used by fetchHTMLPage)
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

// Mock structure-hash
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-dublin"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-dublin",
    name: "Dublin H3 Website Archive",
    url: "https://dublinhhh.com/archive",
    type: "HTML_SCRAPER",
    trustLevel: 7,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: {},
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

describe("stripTruncatedPostalFragment", () => {
  it("strips trailing single-letter Dublin postal fragment", () => {
    expect(stripTruncatedPostalFragment("51 Bar, Haddington Rd, Dublin, D")).toBe(
      "51 Bar, Haddington Rd, Dublin",
    );
  });
  it("strips trailing two-letter fragment", () => {
    expect(stripTruncatedPostalFragment("Some Pub, Dublin, DC")).toBe("Some Pub, Dublin");
  });
  it("preserves a complete address", () => {
    expect(stripTruncatedPostalFragment("Dalkey DART Station")).toBe("Dalkey DART Station");
  });
  it("preserves an address with a numeric postal code", () => {
    expect(stripTruncatedPostalFragment("51 Bar, Haddington Rd, Dublin, D02")).toBe(
      "51 Bar, Haddington Rd, Dublin, D02",
    );
  });
  it("returns undefined for empty input", () => {
    expect(stripTruncatedPostalFragment(undefined)).toBeUndefined();
    expect(stripTruncatedPostalFragment("")).toBeUndefined();
  });
});

describe("DublinHashAdapter", () => {
  describe("parseHarelineRow", () => {
    it("strips trailing truncated postal fragment from location (#453)", () => {
      const cells = [
        "Monday",
        "30 March 2026",
        "19:30",
        "Dublin H3 #1670",
        "51 Bar, Haddington Rd, Dublin, D",
        "Polly",
        "",
      ];
      const event = parseHarelineRow(cells, [undefined, undefined, undefined, undefined, undefined, undefined, undefined], "https://dublinhhh.com/archive");
      expect(event).not.toBeNull();
      expect(event!.location).toBe("51 Bar, Haddington Rd, Dublin");
    });

    const sourceUrl = "https://dublinhhh.com/archive";

    it("parses a standard Dublin H3 row", () => {
      const cells = [
        "Monday",
        "16 March 2026",
        "19:30",
        "Dublin H3 #1668",
        "Dalkey DART Station",
        "Polly",
        'On on at the "The Club"',
      ];
      const hrefs = [
        undefined,
        undefined,
        undefined,
        "/hareline/2026-03-16-dublin-h3/",
        "https://maps.app.goo.gl/vuR36Jdgqy4d4svQ8",
        undefined,
        undefined,
      ];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-03-16");
      expect(event!.startTime).toBe("19:30");
      expect(event!.kennelTag).toBe("dh3");
      expect(event!.title).toBe("Dublin H3 #1668");
      expect(event!.runNumber).toBe(1668);
      expect(event!.location).toBe("Dalkey DART Station");
      expect(event!.locationUrl).toBe("https://maps.app.goo.gl/vuR36Jdgqy4d4svQ8");
      expect(event!.hares).toBe("Polly");
      expect(event!.sourceUrl).toBe("https://dublinhhh.com/hareline/2026-03-16-dublin-h3/");
      expect(event!.description).toBe('On on at the "The Club"');
    });

    it("parses an I Love Monday row", () => {
      const cells = [
        "Monday",
        "23 March 2026",
        "19:30",
        "I ♥ Monday #410",
        "Strand House, Fairview",
        "Stitch",
        "",
      ];
      const hrefs = [
        undefined,
        undefined,
        undefined,
        "/hareline/2026-03-23-i-%E2%99%A5-monday/",
        "https://maps.app.goo.gl/GoSE7C31p1WYWBY26",
        undefined,
        undefined,
      ];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-03-23");
      expect(event!.kennelTag).toBe("dh3");
      expect(event!.title).toBe("I ♥ Monday #410");
      expect(event!.runNumber).toBe(410);
      expect(event!.location).toBe("Strand House, Fairview");
      expect(event!.hares).toBe("Stitch");
    });

    it("handles TBD hares", () => {
      const cells = [
        "Monday",
        "3 July 2026",
        "",
        "Dublin H3 DH3 Nash Hash",
        "Dublin",
        "TBD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-07-03-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.hares).toBeUndefined();
      expect(event!.startTime).toBeUndefined();
      expect(event!.runNumber).toBeUndefined();
    });

    it("handles date range (multi-day event)", () => {
      // The ndash gets decoded to \u2013 by Cheerio
      const cells = [
        "Friday\u2013Sunday",
        "3\u20135 July 2026",
        "",
        "Dublin H3 DH3 Nash Hash",
        "Dublin",
        "TBD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-07-03-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-07-03");
    });

    it("skips rows with insufficient columns", () => {
      const cells = ["Monday", "16 March 2026"];
      const hrefs = [undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).toBeNull();
    });

    it("skips rows with empty date", () => {
      const cells = ["Monday", "", "19:30", "Dublin H3 #1668", "Somewhere", "Someone", ""];
      const hrefs = [undefined, undefined, undefined, undefined, undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).toBeNull();
    });

    it("handles missing location URL", () => {
      const cells = [
        "Monday",
        "14 September 2026",
        "12:00",
        "Dublin H3 #???",
        "TBD",
        "Volunteer",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, "/hareline/2026-09-14-dublin-h3/", undefined, undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.locationUrl).toBeUndefined();
      expect(event!.hares).toBe("Volunteer");
    });

    it("parses afternoon time correctly", () => {
      const cells = [
        "Sunday",
        "5 April 2026",
        "14:00",
        "Dublin H3 #1670",
        "Phoenix Park",
        "PhD",
        "",
      ];
      const hrefs = [undefined, undefined, undefined, undefined, "https://maps.app.goo.gl/abc123", undefined, undefined];

      const event = parseHarelineRow(cells, hrefs, sourceUrl);

      expect(event).not.toBeNull();
      expect(event!.startTime).toBe("14:00");
    });
  });

  describe("fetch — date window filtering", () => {
    let adapter: DublinHashAdapter;

    beforeEach(() => {
      adapter = new DublinHashAdapter();
      vi.clearAllMocks();
    });

    it("filters events outside the date window", async () => {
      // Table with one far-future event (2099) and one near-term event (2026)
      const html = `<html><body>
<table>
  <tr><th>Day</th><th>Date</th><th>Time</th><th>Hash</th><th>Location</th><th>Hares</th><th>Notes</th></tr>
  <tr>
    <td>Monday</td><td>16 March 2099</td><td>19:30</td>
    <td><a href="/archive/2099-03-16-dublin-h3/">Dublin H3 #9999</a></td>
    <td>Far Future Pub</td><td>FutureHare</td><td></td>
  </tr>
  <tr>
    <td>Monday</td><td>16 March 2026</td><td>19:30</td>
    <td><a href="/archive/2026-03-16-dublin-h3/">Dublin H3 #1668</a></td>
    <td>Dalkey DART Station</td><td>Polly</td><td></td>
  </tr>
  <tr>
    <td>Monday</td><td>16 March 1990</td><td>19:30</td>
    <td><a href="/archive/1990-03-16-dublin-h3/">Dublin H3 #100</a></td>
    <td>Ancient Pub</td><td>OldHare</td><td></td>
  </tr>
</table>
</body></html>`;

      mockFetchResponse(html);

      const source = makeSource();
      const result = await adapter.fetch(source, { days: 90 });

      // Far future event (2099) should be filtered out
      const futureEvent = result.events.find((e) => e.date === "2099-03-16");
      expect(futureEvent).toBeUndefined();

      // Far past event (1990) should be filtered out
      const pastEvent = result.events.find((e) => e.date === "1990-03-16");
      expect(pastEvent).toBeUndefined();

      // Near-term event (2026) should be included
      const currentEvent = result.events.find((e) => e.date === "2026-03-16");
      expect(currentEvent).toBeDefined();
      expect(currentEvent!.title).toBe("Dublin H3 #1668");
    });
  });
});
