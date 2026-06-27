import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  CreekHashAdapter,
  parseRunTitle,
  parseTitleDate,
  parseClock,
  parseDetailFields,
  parseHomeSlides,
  stripContactPII,
  isoDate,
} from "./creek-hash";
import * as cheerio from "cheerio";

// Mock safeFetch (used by fetchHTMLPage) + structure-hash so fetch() runs offline.
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-creek"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-creek",
    name: "Creek H3 Website",
    url: "https://www.creekhash.org/",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { upcomingOnly: true },
    enabled: true,
    lastScrapeAt: null,
    lastSuccessAt: null,
    healthStatus: "UNKNOWN",
    baselineResetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function htmlResponse(html: string): Response {
  return { ok: true, status: 200, text: async () => html } as unknown as Response;
}

// --- Real fixtures captured from creekhash.org (2026-06-27, Run 2307) ---

const HOME_HTML = `
<div id="panel-17591-1-1-0" class="so-panel widget widget_siteorigin-panels-postloop">
  <h3 class="widget-title">This Week&#8217;s Meet Point (Click Image For More Details)</h3>
  <div class="flexslider-wrapper">
    <div class="flexslider">
      <ul class="slides">
        <li class="slide">
          <a href="https://www.creekhash.org/?p=22658">
            <img width="960" height="480" src="https://www.creekhash.org/wp-content/uploads/2019/04/x-960x480.jpg" />
            <div class="flex-caption">
              <h3>25th June 2026 &#8211; Run 2307 &#8211; The Vomitorium</h3>
            </div>
          </a>
        </li>
      </ul>
    </div>
  </div>
</div>`;

const DETAIL_HTML = `
<article>
  <div class="entry-content">
    <p><strong>Date:</strong> Thursday 26th June 2026</p>
    <p><strong>Time:</strong> 19:00</p>
    <p><strong>Run No:</strong> 2307</p>
    <p><strong>Location:</strong> The Vomitorium, Villa 3B Umm al Sheif Street</p>
    <p><a href="https://goo.gl/maps/4pNpRtWQua42">Google Maps Link</a></p>
    <p><strong>Hares:</strong> Vomit</p>
    <p><strong>Contact if lost:</strong> Vomit &#8211; 055 5011504</p>
    <p><strong>Directions:</strong> From Al Wasl Road, turn left at the Spinneys junction. Park 75m down on the right.</p>
  </div>
</article>`;

describe("isoDate", () => {
  it("zero-pads to YYYY-MM-DD", () => {
    expect(isoDate(2026, 6, 25)).toBe("2026-06-25");
  });
  it("rejects an out-of-range month", () => {
    expect(isoDate(2026, 13, 1)).toBeNull();
  });
  it("rejects impossible calendar dates rather than rolling them over", () => {
    expect(isoDate(2026, 6, 31)).toBeNull(); // June has 30 days
    expect(isoDate(2026, 2, 30)).toBeNull(); // February
    expect(isoDate(2025, 2, 29)).toBeNull(); // non-leap year
    expect(isoDate(2024, 2, 29)).toBe("2024-02-29"); // leap year is valid
  });
});

describe("parseTitleDate", () => {
  it("parses an ordinal date with a full month name", () => {
    expect(parseTitleDate("25th June 2026")).toBe("2026-06-25");
  });
  it("handles single-digit days and other ordinals", () => {
    expect(parseTitleDate("4th December 2007")).toBe("2007-12-04");
    expect(parseTitleDate("1st January 2020")).toBe("2020-01-01");
  });
  it("returns null when no year-bearing date is present", () => {
    expect(parseTitleDate("Run 2307")).toBeNull();
  });
  it("returns null for an impossible day (source typo) instead of rolling over", () => {
    expect(parseTitleDate("31st June 2026")).toBeNull();
  });
});

describe("parseClock", () => {
  it("normalizes to HH:MM", () => {
    expect(parseClock("19:00")).toBe("19:00");
    expect(parseClock("7:05")).toBe("07:05");
  });
  it("returns undefined for non-times", () => {
    expect(parseClock("TBD")).toBeUndefined();
    expect(parseClock(undefined)).toBeUndefined();
  });
  it("rejects out-of-range hours and minutes", () => {
    expect(parseClock("25:00")).toBeUndefined();
    expect(parseClock("12:60")).toBeUndefined();
  });
});

describe("parseRunTitle", () => {
  it("parses date + run number + venue from a Creek Run title", () => {
    expect(parseRunTitle("25th June 2026 – Run 2307 – The Vomitorium")).toEqual({
      date: "2026-06-25",
      runNumber: 2307,
      venue: "The Vomitorium",
    });
  });

  it("parses old-archive titles back to 2001", () => {
    expect(parseRunTitle("12th April 2001 – Run 1000 – Beach Bash")).toEqual({
      date: "2001-04-12",
      runNumber: 1000,
      venue: "Beach Bash",
    });
  });

  it("SKIPS special-run labels that are not 'Run N' (Spit Roast)", () => {
    expect(parseRunTitle("17th July 2008 – Spit Roast 3 – A Bonk in Barsha")).toBeNull();
  });

  it("preserves profanity in venue strings verbatim", () => {
    const r = parseRunTitle("3rd March 2016 – Run 1750 – F*cking Dipstick's Scrapyard");
    expect(r?.venue).toBe("F*cking Dipstick's Scrapyard");
  });

  it("returns null when the date does not parse", () => {
    expect(parseRunTitle("Run 2307 – The Vomitorium")).toBeNull();
  });

  it("emits no venue when the title has only date + run", () => {
    expect(parseRunTitle("25th June 2026 – Run 2307")).toEqual({
      date: "2026-06-25",
      runNumber: 2307,
      venue: undefined,
    });
  });
});

describe("stripContactPII", () => {
  it("strips a trailing dash-led phone fragment", () => {
    expect(stripContactPII("Vomit – 055 5011504")).toBe("Vomit");
  });
  it("leaves a clean hare name untouched", () => {
    expect(stripContactPII("Vomit")).toBe("Vomit");
  });
});

describe("parseHomeSlides", () => {
  it("extracts the meet-point slide with an absolute detail URL", () => {
    const $ = cheerio.load(HOME_HTML);
    const slides = parseHomeSlides($);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({
      date: "2026-06-25",
      runNumber: 2307,
      venue: "The Vomitorium",
      detailUrl: "https://www.creekhash.org/?p=22658",
    });
  });

  it("resolves a relative detail href against the base URL", () => {
    const $ = cheerio.load(HOME_HTML.replace("https://www.creekhash.org/?p=22658", "?p=22658"));
    const slides = parseHomeSlides($, "https://www.creekhash.org/");
    expect(slides[0].detailUrl).toBe("https://www.creekhash.org/?p=22658");
  });
});

describe("parseDetailFields", () => {
  it("reads Time / Location / Hares / Maps href from labeled rows", () => {
    const $ = cheerio.load(DETAIL_HTML);
    const fields = parseDetailFields($);
    expect(fields.startTime).toBe("19:00");
    expect(fields.location).toBe("The Vomitorium, Villa 3B Umm al Sheif Street");
    expect(fields.hares).toBe("Vomit");
    expect(fields.locationUrl).toBe("https://goo.gl/maps/4pNpRtWQua42");
  });

  it("never reads the Contact-if-lost phone into any field (PII)", () => {
    const $ = cheerio.load(DETAIL_HTML);
    const fields = parseDetailFields($);
    const joined = JSON.stringify(fields);
    expect(joined).not.toContain("5011504");
    expect(joined).not.toContain("055");
    // The legitimate "Villa 3B" digit in the location must survive.
    expect(fields.location).toContain("3B");
  });
});

describe("CreekHashAdapter.fetch", () => {
  it("emits one event from the home slide + detail page, with no title", async () => {
    mockedSafeFetch
      .mockResolvedValueOnce(htmlResponse(HOME_HTML)) // home
      .mockResolvedValueOnce(htmlResponse(DETAIL_HTML)); // detail ?p=22658

    const result = await new CreekHashAdapter().fetch(makeSource(), { days: 365 });

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(1);
    const ev = result.events[0];
    expect(ev.date).toBe("2026-06-25");
    expect(ev.kennelTags).toEqual(["ch3-ae"]);
    expect(ev.runNumber).toBe(2307);
    expect(ev.title).toBeUndefined();
    expect(ev.startTime).toBe("19:00");
    expect(ev.location).toBe("The Vomitorium, Villa 3B Umm al Sheif Street");
    expect(ev.hares).toBe("Vomit");
    expect(ev.locationUrl).toBe("https://goo.gl/maps/4pNpRtWQua42");
    expect(JSON.stringify(ev)).not.toContain("5011504");
  });

  it("still emits a leaner event (slide data only) when the detail fetch fails", async () => {
    mockedSafeFetch
      .mockResolvedValueOnce(htmlResponse(HOME_HTML)) // home OK
      .mockRejectedValueOnce(new Error("detail timeout")); // detail fetch fails

    const result = await new CreekHashAdapter().fetch(makeSource(), { days: 365 });

    expect(result.events).toHaveLength(1);
    const ev = result.events[0];
    expect(ev.date).toBe("2026-06-25");
    expect(ev.runNumber).toBe(2307);
    expect(ev.location).toBe("The Vomitorium"); // venue from the title, no detail Location:
    expect(ev.startTime).toBeUndefined(); // detail-only field absent
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("fails loud (errors) when the meet-point block parses 0 runs", async () => {
    mockedSafeFetch.mockResolvedValueOnce(
      htmlResponse('<div class="flexslider"><ul class="slides"></ul></div>'),
    );

    const result = await new CreekHashAdapter().fetch(makeSource(), { days: 365 });

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toMatch(/parsed 0 runs/i);
  });
});
