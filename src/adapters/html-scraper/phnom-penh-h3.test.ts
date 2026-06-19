import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  PhnomPenhH3Adapter,
  parseHomeRow,
  parseHomeDate,
  parseNewsDate,
  parseNewsDetail,
  newsDetailToRawEvent,
} from "./phnom-penh-h3";

// Mock safeFetch (used by fetchHTMLPage) + structure-hash.
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-p2h3"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://www.p2h3.com/";

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-p2h3",
    name: "Phnom Penh H3 Website",
    url: SOURCE_URL,
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 90,
    config: { upcomingOnly: true },
    isActive: true,
    lastScrapedAt: null,
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

// Build a UTC-noon date N days from now in both DD.MM.YYYY (home) and ISO so
// the adapter window-filter test never ages out (the dublin time-bomb lesson).
function relativeDate(daysFromNow: number): { dotted: string; iso: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return { dotted: `${dd}.${mm}.${yyyy}`, iso: `${yyyy}-${mm}-${dd}` };
}

// Real /news/1841 post body (captured 2026-06-19), wrapped in the Grav
// #body-wrapper container the parser scopes to.
const NEWS_1841_HTML = `<!DOCTYPE html><html><body>
<section id="body-wrapper" class="section"><section class="container grid-lg">
<p><strong>Run No. 1841</strong></p>
<p>Date/Time:- Sunday 21st June 2026</p>
<p>(A-A Run) - <a href="https://maps.app.goo.gl/7zHMnvXwwKReFwGj6">A-point</a></p>
<ul>
<li><p>Meeting Point: <a href="https://maps.app.goo.gl/c54n4RjMcRnRdMpS8">Villa Grange</a>, meeting at 13.15 for 13.30 departure</p></li>
<li><p><strong>Location</strong>:  <a href="https://maps.app.goo.gl/7zHMnvXwwKReFwGj6">Pothiprek Pagoda</a></p></li>
<li><p>Walking : 5km</p></li>
<li><p>Running : 10km</p></li>
</ul>
<p>Special instructions/comments: N/A</p>
<ul>
<li><p><strong>On On</strong>: <a href="https://maps.app.goo.gl/4zS2KWUuGFFwodJA7">Villa Grange</a></p></li>
<li><p><strong>Hares</strong>: Short Stump &amp; Just Quynh Anh</p></li>
</ul>
</section></section>
<section id="footer"><p>&copy; 2026 P2H3.</p></section>
</body></html>`;

describe("parseHomeDate", () => {
  it("parses DD.MM.YYYY to UTC-noon ISO", () => {
    expect(parseHomeDate("21.06.2026")).toBe("2026-06-21");
    expect(parseHomeDate("05.07.2026")).toBe("2026-07-05");
  });
  it("rejects an overflow date", () => {
    expect(parseHomeDate("31.02.2026")).toBeNull();
  });
  it("rejects a non-date string", () => {
    expect(parseHomeDate("TBC")).toBeNull();
    expect(parseHomeDate("2026-06-21")).toBeNull();
  });
});

describe("parseNewsDate", () => {
  it("parses a weekday + ordinal + month-name + year heading", () => {
    expect(parseNewsDate("Sunday 21st June 2026")).toBe("2026-06-21");
    expect(parseNewsDate("Sunday 7th June 2026")).toBe("2026-06-07");
  });
});

describe("parseHomeRow", () => {
  const COLS = ["1841", "21.06.2026", "Bus", "Short Stump & Just Quynh Anh", "A-site", "A-site=B-site", "Some remark"];

  it("parses the current row (with /news link + A-site Maps link)", () => {
    const hrefs = [
      "/news/1841",
      undefined,
      undefined,
      undefined,
      "https://maps.app.goo.gl/RToGwFS82tzuHdzX9",
      "https://maps.app.goo.gl/RToGwFS82tzuHdzX9",
      undefined,
    ];
    const event = parseHomeRow(COLS, hrefs, SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-06-21");
    expect(event!.runNumber).toBe(1841);
    expect(event!.kennelTags).toEqual(["phnom-penh-h3"]);
    expect(event!.hares).toBe("Short Stump & Just Quynh Anh");
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/RToGwFS82tzuHdzX9");
    expect(event!.startTime).toBe("13:30");
    expect(event!.sourceUrl).toBe("https://www.p2h3.com/news/1841");
    expect(event!.title).toBeUndefined(); // merge synthesizes "Phnom Penh H3 Trail #N"
  });

  it("does NOT treat the 'By' column (Bus) as a hare", () => {
    const cells = ["1842", "27.06.2026", "Bus", "TBC", "TBC", "TBC", "Saturday Hash!"];
    const event = parseHomeRow(cells, [], SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined(); // "TBC" stripped
    expect(event!.description).toBe("Saturday Hash!");
    expect(event!.sourceUrl).toBe(SOURCE_URL); // no /news link on upcoming rows
  });

  it("strips placeholder hares and remarks", () => {
    const cells = ["1843", "05.07.2026", "TBC", "Hares Needed!", "TBC", "TBC", "/N/A"];
    const event = parseHomeRow(cells, [], SOURCE_URL);
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.description).toBeUndefined();
    expect(event!.locationUrl).toBeUndefined();
  });

  it("returns null for a decorative / non-numeric row", () => {
    expect(parseHomeRow(["Number", "Date", "By", "Hares"], [], SOURCE_URL)).toBeNull();
  });

  it("returns null for too-few columns", () => {
    expect(parseHomeRow(["1841", "21.06.2026"], [], SOURCE_URL)).toBeNull();
  });
});

describe("parseNewsDetail", () => {
  it("extracts every labeled field from a /news post", () => {
    const detail = parseNewsDetail(NEWS_1841_HTML);
    expect(detail.runNumber).toBe(1841);
    expect(detail.date).toBe("2026-06-21");
    expect(detail.startTime).toBe("13:30");
    expect(detail.location).toBe("Pothiprek Pagoda");
    expect(detail.locationUrl).toBe("https://maps.app.goo.gl/7zHMnvXwwKReFwGj6");
    expect(detail.hares).toBe("Short Stump & Just Quynh Anh");
    expect(detail.onOn).toBe("Villa Grange");
    expect(detail.trailLengthText).toBe("10 km run / 5 km walk");
    expect(detail.trailLengthMinMiles).toBeCloseTo(3.11, 2);
    expect(detail.trailLengthMaxMiles).toBeCloseTo(6.21, 2);
  });
});

describe("newsDetailToRawEvent", () => {
  it("builds a full RawEventData from a parsed detail", () => {
    const detail = parseNewsDetail(NEWS_1841_HTML);
    const event = newsDetailToRawEvent(detail, "https://www.p2h3.com/news/1841");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(1841);
    expect(event!.date).toBe("2026-06-21");
    expect(event!.kennelTags).toEqual(["phnom-penh-h3"]);
    expect(event!.location).toBe("Pothiprek Pagoda");
    expect(event!.startTime).toBe("13:30");
    expect(event!.description).toBe("On On: Villa Grange");
  });

  it("returns null when run number or date is missing", () => {
    expect(newsDetailToRawEvent({ date: "2026-06-21" }, "u")).toBeNull();
    expect(newsDetailToRawEvent({ runNumber: 1841 }, "u")).toBeNull();
  });
});

describe("PhnomPenhH3Adapter.fetch", () => {
  let adapter: PhnomPenhH3Adapter;

  beforeEach(() => {
    adapter = new PhnomPenhH3Adapter();
    vi.clearAllMocks();
  });

  it("parses both home tables and enriches the current run from /news", async () => {
    const current = relativeDate(2);
    const upcoming = relativeDate(9);
    const homeHtml = `<!DOCTYPE html><html><body><section id="body-wrapper">
<table><thead><tr><th>Number</th><th>Date</th><th>By</th><th>Hares</th><th>A-Site</th><th>B-Site</th><th>Remarks</th></tr></thead>
<tbody><tr>
<td><a href="/news/1841">1841</a></td><td>${current.dotted}</td><td>Bus</td>
<td>Short Stump &amp; Just Quynh Anh</td>
<td><a href="https://maps.app.goo.gl/RToGwFS82tzuHdzX9">A-site</a></td>
<td><a href="https://maps.app.goo.gl/RToGwFS82tzuHdzX9">A-site=B-site</a></td>
<td>Meeting at Villa Grange 13.45 for 14.00 departure</td>
</tr></tbody></table>
<table><thead><tr><th>Number</th><th>Date</th><th>By</th><th>Hares</th><th>A-Site</th><th>B-Site</th><th>Remarks</th></tr></thead>
<tbody><tr>
<td>1842</td><td>${upcoming.dotted}</td><td>TBC</td><td>Hares Needed!</td><td>TBC</td><td>TBC</td><td>Saturday Hash!</td>
</tr></tbody></table>
</section></body></html>`;

    mockedSafeFetch.mockImplementation(async (url: string | URL) => {
      return htmlResponse(String(url).includes("/news/") ? NEWS_1841_HTML : homeHtml);
    });

    const result = await adapter.fetch(makeSource(), { days: 90 });

    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(2);

    const cur = result.events.find((e) => e.runNumber === 1841);
    expect(cur).toBeDefined();
    expect(cur!.date).toBe(current.iso); // home date stays canonical
    // Enrichment overlays the richer /news fields:
    expect(cur!.location).toBe("Pothiprek Pagoda");
    expect(cur!.locationUrl).toBe("https://maps.app.goo.gl/7zHMnvXwwKReFwGj6");
    expect(cur!.startTime).toBe("13:30");
    expect(cur!.trailLengthText).toBe("10 km run / 5 km walk");

    const up = result.events.find((e) => e.runNumber === 1842);
    expect(up).toBeDefined();
    expect(up!.hares).toBeUndefined(); // "Hares Needed!" stripped
    expect(up!.description).toBe("Saturday Hash!");
    expect(up!.startTime).toBe("13:30"); // kennel default (not enriched)
  });

  it("fails loud (errors[]) when no run rows parse", async () => {
    const emptyHtml = `<!DOCTYPE html><html><body><section id="body-wrapper">
<table><thead><tr><th>Number</th><th>Date</th></tr></thead><tbody></tbody></table>
</section></body></html>`;
    mockedSafeFetch.mockResolvedValue(htmlResponse(emptyHtml));

    const result = await adapter.fetch(makeSource(), { days: 90 });
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("no upcoming runs");
  });
});
