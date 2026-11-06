import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseHarelineRow, DublinHashAdapter, stripTruncatedPostalFragment, buildDublinRouting, routeDublinLabel } from "./dublin-hash";
import { compileSilentSkipRules, matchSilentSkip } from "../skip-rules";
import { SOURCES } from "../../../prisma/seed-data/sources";

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

// Build a date relative to "now" in both the parser's display format
// ("D Month YYYY") and ISO ("YYYY-MM-DD"). The window-filter test below must
// keep its "near-term" event inside buildDateWindow(90); pinning an absolute
// date silently rots once the wall clock passes it (the same time-bomb that hit
// atlanta-hash-board on 2026-06-08). Far-past/far-future rows can stay static —
// 1990 and 2099 are outside ±90 days for any plausible run date.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
function relativeDate(daysFromNow: number): { display: string; iso: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return {
    display: `${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${yyyy}`,
    iso: `${yyyy}-${mm}-${dd}`,
  };
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
  it("strips fragment followed by trailing nbsp (#905)", () => {
    expect(
      stripTruncatedPostalFragment("51 Bar, Haddington Rd, Dublin, D\u00A0"),
    ).toBe("51 Bar, Haddington Rd, Dublin");
  });
  it("normalizes interior nbsp to space before stripping (#905)", () => {
    expect(
      stripTruncatedPostalFragment("Dublin,\u00A0D"),
    ).toBe("Dublin");
  });
  it("returns undefined for empty input", () => {
    expect(stripTruncatedPostalFragment(undefined)).toBeUndefined();
    expect(stripTruncatedPostalFragment("")).toBeUndefined();
  });
});

// The shipped seed config — tests route through exactly what prod runs.
function findDublinSeedConfig() {
  const seed = SOURCES.find((src) => src.name === "Dublin H3 Website Hareline");
  if (!seed?.config) throw new Error("Dublin H3 Website Hareline seed config missing");
  return seed.config as { silentlySkipPatterns?: unknown };
}
const DUBLIN_CONFIG = findDublinSeedConfig();
const DUBLIN_ROUTING = buildDublinRouting(DUBLIN_CONFIG);
const DUBLIN_SKIP_RULES = compileSilentSkipRules(DUBLIN_CONFIG.silentlySkipPatterns);

// Every Hash-column label shape in the live dublinhhh.com/archive (221 rows,
// fetched 2026-11-06) plus its kennel. Locks the #2759 routing decisions.
describe("Dublin hareline routing (#2759, seed config)", () => {
  it.each([
    ["Dublin H3 #1685", "dh3"],
    ["Dublin H3 #1674 Pride Run", "dh3"],
    ["Dublin H3 #1610 Wren Boys Run", "dh3"],
    ["Dublin H3 #1636 Wren Boys Run --", "dh3"],
    ["Dublin H3 #1639 St. Brigid's Day", "dh3"],
    ["Dublin H3 #1587 Australia Day Run", "dh3"],
    ["Dublin H3 DH3 Nash Hash", "dh3"],
    // 2025 Wren Boys was filed as an "Other" hash under an i-♥-monday slug;
    // it is still a Dublin H3 run (default kennel).
    ["Wren Boys Run #", "dh3"],
    // Dublin HHH's own Paddy's Day pick-up and a guest run it hosted.
    ["Pickup", "dh3"],
    ["Shanghai Guest Hash 5th Shanghai Reunion", "dh3"],
    ["I ♥ Monday #427", "i-love-monday"],
    ["I ♥ Monday #376 Mince Pie Run", "i-love-monday"],
    ["I ♥ Monday", "i-love-monday"],
    ["I Love Monday #400", "i-love-monday"],
    ["I\u00A0♥\u00A0Monday #429", "i-love-monday"],
    ["Shed Hash", "shed-h3"],
    ["Shed Hash #5", "shed-h3"],
    ["Shed #6", "shed-h3"],
    ["Shed Hash #7 The Magnificent Seven and The return of the Shedi", "shed-h3"],
  ])("routes %j → %s and keeps it", (label, kennel) => {
    expect(routeDublinLabel(label, DUBLIN_ROUTING)).toBe(kennel);
    expect(matchSilentSkip({ date: "2026-01-05", kennelTags: [kennel], title: label }, DUBLIN_SKIP_RULES)).toBeNull();
  });

  it.each([
    // Marathon water-station volunteer shifts are not trails.
    "Marathon Water Stop",
    "Other MARATHON WATER STATION",
    // Cork H3's Paddy's Day trail in Cork, listed for information.
    "Cork H3",
  ])("drops %j via silentlySkipPatterns", (label) => {
    expect(matchSilentSkip({ date: "2026-01-05", kennelTags: ["dh3"], title: label }, DUBLIN_SKIP_RULES)).not.toBeNull();
  });

  it("routes everything to dh3 when the source has no config", () => {
    expect(routeDublinLabel("I ♥ Monday #427", buildDublinRouting(null))).toBe("dh3");
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
      expect(event!.kennelTags[0]).toBe("dh3");
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

      const event = parseHarelineRow(cells, hrefs, sourceUrl, routeDublinLabel(cells[3], DUBLIN_ROUTING));

      expect(event).not.toBeNull();
      expect(event!.date).toBe("2026-03-23");
      // #2759: I ♥ Monday is its own kennel with its own run sequence.
      expect(event!.kennelTags).toEqual(["i-love-monday"]);
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

  describe("fetch — kennel routing", () => {
    beforeEach(() => vi.clearAllMocks());

    it("routes each series to its kennel using the source config", async () => {
      const near = relativeDate(7);
      const later = relativeDate(14);
      const html = `<html><body><table>
  <tr><th>Day</th><th>Date</th><th>Time</th><th>Hash</th><th>Location</th><th>Hares</th><th>Notes</th></tr>
  <tr><td>Monday</td><td>${near.display}</td><td>19:30</td>
    <td><a href="/hareline/${near.iso}-dublin-h3/">Dublin H3 #1685</a></td>
    <td>Four Provinces Brew Co</td><td>Wot the Phoque</td><td></td></tr>
  <tr><td>Monday</td><td>${later.display}</td><td>19:30</td>
    <td><a href="/hareline/${later.iso}-i-%E2%99%A5-monday/">I ♥ Monday #427</a></td>
    <td>Beachcomber, Killester</td><td>Knuthead</td><td></td></tr>
</table></body></html>`;
      mockFetchResponse(html);

      const result = await new DublinHashAdapter().fetch(makeSource({ config: DUBLIN_CONFIG as never }), { days: 90 });

      expect(result.events.map((e) => [e.kennelTags[0], e.runNumber])).toEqual([
        ["dh3", 1685],
        ["i-love-monday", 427],
      ]);
    });
  });

  describe("fetch — date window filtering", () => {
    let adapter: DublinHashAdapter;

    beforeEach(() => {
      adapter = new DublinHashAdapter();
      vi.clearAllMocks();
    });

    it("filters events outside the date window", async () => {
      // Near-term date is relative to "now" so it never ages out of the
      // ±90-day window (see relativeDate helper). Far-future (2099) and
      // far-past (1990) rows stay static — always outside ±90 days.
      const near = relativeDate(7);
      const html = `<html><body>
<table>
  <tr><th>Day</th><th>Date</th><th>Time</th><th>Hash</th><th>Location</th><th>Hares</th><th>Notes</th></tr>
  <tr>
    <td>Monday</td><td>16 March 2099</td><td>19:30</td>
    <td><a href="/archive/2099-03-16-dublin-h3/">Dublin H3 #9999</a></td>
    <td>Far Future Pub</td><td>FutureHare</td><td></td>
  </tr>
  <tr>
    <td>Monday</td><td>${near.display}</td><td>19:30</td>
    <td><a href="/archive/${near.iso}-dublin-h3/">Dublin H3 #1668</a></td>
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

      // Near-term event should be included
      const currentEvent = result.events.find((e) => e.date === near.iso);
      expect(currentEvent).toBeDefined();
      expect(currentEvent!.title).toBe("Dublin H3 #1668");
    });
  });
});
