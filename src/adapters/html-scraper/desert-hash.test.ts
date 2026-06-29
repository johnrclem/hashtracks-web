import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  DesertHashAdapter,
  parseHomeUpcoming,
  parseHareLine,
  parseRunTitle,
  parseClock,
  parseTimeRange,
  parseMonthDay,
  isoDate,
  parseDetailPage,
} from "./desert-hash";
import * as cheerio from "cheerio";

// Mock safeFetch (used by fetchHTMLPage) + structure-hash so fetch() runs offline.
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-desert"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-desert",
    name: "Desert H3 Website",
    url: "https://www.deserthash.org/",
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

/** Route the two fetches: base URL → home HTML, `?page_id=5152` → Hare Line HTML. */
function mockTwoSurfaces(homeHtml: string, hareHtml: string) {
  mockedSafeFetch.mockImplementation((url: string) => {
    const html = String(url).includes("page_id=5152") ? hareHtml : homeHtml;
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(html),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response);
  });
}

// ── Fixtures — faithful to the live MEC markup (en-dash via &#8211;) ──────────

/** One MEC "next event" card. */
function homeCard(runText: string, dmy: string, time: string, slug: string): string {
  return `<div id="mec-calendar-events-sec-mec1"><article class="mec-event-article">
    <div class="mec-event-date"><span class="mec-start-date-label">${dmy}</span></div>
    <div class="mec-event-time mec-color"><i class="mec-sl-clock-o"></i> ${time}</div>
    <h4 class="mec-event-title"><a class="mec-color-hover" href="https://www.deserthash.org/?mec-events=${slug}">${runText}</a></h4>
  </article></div>`;
}

/** One agenda day row inside a Hare Line month section. */
function agendaDay(day: string, agendaDate: string, start: string, end: string, runText: string, slug: string): string {
  return `<div class="mec-events-agenda">
    <div class="mec-agenda-date-wrap"><i class="mec-sl-calendar"></i>
      <span class="mec-agenda-day">${day}</span><span class="mec-agenda-date">${agendaDate}</span>
    </div>
    <div class="mec-agenda-events-wrap">
      <div class="mec-past-event mec-agenda-event">
        <i class="mec-sl-clock"></i><span class="mec-agenda-time"><span class="mec-start-time">${start}</span> - <span class="mec-end-time">${end}</span></span>
        <span class="mec-agenda-event-title"><a class="mec-color-hover" href="https://www.deserthash.org/?mec-events=${slug}">${runText}</a></span>
      </div>
    </div>
  </div>`;
}

function monthDivider(yyyymm: string, label: string): string {
  return `<div class="mec-month-divider" data-toggle-divider="mec-toggle-${yyyymm}-mec1"><h5>${label}</h5><i class="mec-sl-arrow-down"></i></div>`;
}

/** One MEC run detail page — faithful to the live organizer + description + gmap markup. */
function detailPage(opts: { hares?: string[]; bodyHtml: string; lat?: string; lng?: string }): string {
  const organizer = opts.hares?.length
    ? `<div class="mec-event-meta"><div class="mec-single-event-organizer">
         <div class="mec-events-single-section-title">Hare(s)</div>
         ${opts.hares.map((h) => `<dd class="mec-organizer"><i class="mec-sl-people"></i><span class="mec-meta-label">${h}</span></dd>`).join("")}
         <dd class="mec-organizer-tel"><i class="mec-sl-phone"></i><span class="mec-meta-label">Phone</span><a href="tel:+971 56 770 2627">+971 56 770 2627</a></dd>
       </div></div>`
    : "";
  const gmap = opts.lat && opts.lng
    ? `<div class="mec-events-meta-group mec-events-meta-group-gmap"><script>
         p1 = jQuery("#m").mecGoogleMaps({ latitude: "${opts.lat}", longitude: "${opts.lng}", autoinit: true, zoom: 15 });
       </script></div>`
    : "";
  return `<html><body>${organizer}${gmap}
    <div class="mec-single-event-description mec-events-content ">${opts.bodyHtml}</div>
  </body></html>`;
}

// 2456-style: structured location (coords present) → venue-first body.
const DETAIL_VENUE = detailPage({
  hares: ["Thighs Wide Open"],
  lat: "25.054545",
  lng: "55.207260",
  bodyHtml: `<p>Goose Island Tap House, JVC</p>
    <p><a href="https://maps.app.goo.gl/x1MbEGtWCutGho2B7">Google Map Link</a></p>`,
});

// 2455-style: no coords → body is free-form notes; phone present but must be skipped.
const DETAIL_NOTES = detailPage({
  hares: ["Dyke"],
  bodyHtml: `<p>Note: This is a Sunday run, there will be no hash on the Monday immediately following.</p>
    <p><a href="https://maps.app.goo.gl/RK2tAK8tNURUcS3a8?g_st=iwb">Google Map Link</a></p>
    <p>Park in the car park and walk a few mins down the hill to the circle site.</p>
    <p><a href="https://www.deserthash.org/wp-content/uploads/2025/09/alqudracycle.jpeg"><img src="x" alt="" /></a></p>`,
});

/** Route base→home, page_id=5152→hareline, and any `mec-events=<slug>`→detail HTML. */
function mockSurfacesWithDetails(homeHtml: string, hareHtml: string, details: Record<string, string>) {
  mockedSafeFetch.mockImplementation((url: string) => {
    const u = String(url);
    let html = homeHtml;
    if (u.includes("page_id=5152")) {
      html = hareHtml;
    } else {
      for (const [slug, h] of Object.entries(details)) {
        if (u.includes(slug)) { html = h; break; }
      }
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      statusText: "OK",
      text: () => Promise.resolve(html),
      headers: new Headers({ "content-type": "text/html" }),
    } as Response);
  });
}

// Home: the upcoming DH3 run + a Moonshine card + an Interhash one-off (both must be filtered out).
const HOME_HTML = `<html><body>
  ${homeCard("DH3 &#8211; Run 2457", "29/06/2026", "19:00 - 22:00", "dh3-run-2457")}
  ${homeCard("Moonshine H3 &#8211; Run 15", "30/06/2026", "20:00 - 22:00", "moonshine-15")}
  ${homeCard("Interhash 2026 &#8211; Indonesia", "01/07/2026", "00:00 - 23:59", "interhash-2026")}
</body></html>`;

// Hare Line: June 2026 (Monday run #2456, plus a duplicate skin of it to exercise dedup)
// and May 2026 (Sunday run #2452, a themed run #2440, and a Moonshine row to filter).
const HARELINE_HTML = `<html><body>
  ${monthDivider("202606", "June 2026")}
  ${agendaDay("Monday", "June 22", "19:00", "22:00", "DH3 &#8211; Run 2456", "dh3-run-2456")}
  ${agendaDay("Monday", "June 22", "19:00", "22:00", "DH3 &#8211; Run 2456", "dh3-run-2456-dup")}
  ${monthDivider("202605", "May 2026")}
  ${agendaDay("Sunday", "May 24", "17:00", "22:00", "DH3 &#8211; Run 2452", "dh3-run-2452")}
  ${agendaDay("Saturday", "May 17", "19:00", "22:00", "Moonshine H3 &#8211; Run 14", "moonshine-14")}
  ${agendaDay("Monday", "May 4", "19:00", "22:00", "DH3 &#8211; Run 2440 &#8211; The War Edition", "dh3-run-2440")}
</body></html>`;

const NO_RUNS_HTML = `<html><body>
  ${monthDivider("202606", "June 2026")}
  ${agendaDay("Saturday", "June 20", "20:00", "22:00", "Moonshine H3 &#8211; Run 15", "moonshine-15")}
</body></html>`;

// A divider with NO data-toggle-divider attribute — year must fall back to the
// "<h5>Month YYYY</h5>" heading text (exercises dividerYear's YEAR_RE branch).
const HARELINE_HEADING_ONLY = `<html><body>
  <div class="mec-month-divider"><h5>April 2026</h5></div>
  ${agendaDay("Sunday", "April 19", "15:00", "22:00", "DH3 &#8211; Run 2447", "dh3-run-2447")}
</body></html>`;

// ── Pure helper tests ─────────────────────────────────────────────────────────

describe("parseClock", () => {
  it("normalizes to HH:MM", () => {
    expect(parseClock("19:00")).toBe("19:00");
    expect(parseClock("7:05")).toBe("07:05");
    expect(parseClock(" 14:00 ")).toBe("14:00");
  });
  it("rejects out-of-range / missing", () => {
    expect(parseClock("25:00")).toBeUndefined();
    expect(parseClock("noon")).toBeUndefined();
    expect(parseClock(undefined)).toBeUndefined();
  });
});

describe("parseTimeRange", () => {
  it("splits a HH:MM - HH:MM range", () => {
    expect(parseTimeRange("19:00 - 22:00")).toEqual({ startTime: "19:00", endTime: "22:00" });
    expect(parseTimeRange("15:45 – 22:00")).toEqual({ startTime: "15:45", endTime: "22:00" });
  });
  it("handles a single time / empty", () => {
    expect(parseTimeRange("19:00")).toEqual({ startTime: "19:00", endTime: undefined });
    expect(parseTimeRange(undefined)).toEqual({});
  });
});

describe("parseMonthDay", () => {
  it("parses Month Day", () => {
    expect(parseMonthDay("June 22")).toEqual({ month: 6, day: 22 });
    expect(parseMonthDay("January 4")).toEqual({ month: 1, day: 4 });
  });
  it("tolerates stray punctuation and ordinals", () => {
    expect(parseMonthDay("June, 22")).toEqual({ month: 6, day: 22 });
    expect(parseMonthDay("June 22nd")).toEqual({ month: 6, day: 22 });
  });
});

describe("isoDate", () => {
  it("zero-pads valid dates", () => {
    expect(isoDate(2026, 6, 7)).toBe("2026-06-07");
  });
  it("rejects invalid", () => {
    expect(isoDate(2026, 13, 1)).toBeNull();
    expect(isoDate(2026, 6, 0)).toBeNull();
  });
});

describe("parseRunTitle (title filter)", () => {
  it("accepts a DH3 run and leaves title undefined when no theme", () => {
    expect(parseRunTitle("DH3 – Run 2456")).toEqual({ runNumber: 2456, title: undefined });
  });
  it("keeps a trailing theme as the title", () => {
    expect(parseRunTitle("DH3 – Run 2440 – The War Edition")).toEqual({
      runNumber: 2440,
      title: "The War Edition",
    });
  });
  it("rejects Moonshine, Interhash, and non-runs", () => {
    expect(parseRunTitle("Moonshine H3 – Run 15")).toBeNull();
    expect(parseRunTitle("Interhash 2026 – Indonesia")).toBeNull();
    expect(parseRunTitle("Virtual DH3 social")).toBeNull();
  });
  it("tolerates hyphen and em-dash separators", () => {
    expect(parseRunTitle("DH3 - Run 2456")?.runNumber).toBe(2456);
    expect(parseRunTitle("DH3 — Run 2456")?.runNumber).toBe(2456);
  });
});

// ── Surface parsers ────────────────────────────────────────────────────────────

describe("parseHomeUpcoming", () => {
  const events = parseHomeUpcoming(cheerio.load(HOME_HTML));

  it("ingests only the DH3 run (Moonshine + Interhash filtered)", () => {
    expect(events).toHaveLength(1);
    expect(events.map((e) => e.title ?? `#${e.runNumber}`)).not.toContain("Moonshine");
  });
  it("parses the upcoming run with UTC-noon date + HH:MM times", () => {
    const e = events[0];
    expect(e.date).toBe("2026-06-29");
    expect(e.startTime).toBe("19:00");
    expect(e.endTime).toBe("22:00");
    expect(e.runNumber).toBe(2457);
    expect(e.title).toBeUndefined();
    expect(e.kennelTags).toEqual(["dh3-ae"]);
    expect(e.sourceUrl).toContain("dh3-run-2457");
  });
});

describe("parseHareLine", () => {
  const events = parseHareLine(cheerio.load(HARELINE_HTML));
  const byRun = new Map(events.map((e) => [e.runNumber, e]));

  it("filters out Moonshine and dedupes duplicate skins", () => {
    // 2456 (deduped from 2 copies), 2452, 2440 — not the Moonshine row.
    expect(events).toHaveLength(3);
    expect([...byRun.keys()].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([2440, 2452, 2456]);
  });
  it("takes the year from the month divider (year-bearing, no inference)", () => {
    expect(byRun.get(2456)?.date).toBe("2026-06-22"); // June 2026 divider
    expect(byRun.get(2452)?.date).toBe("2026-05-24"); // May 2026 divider
  });
  it("parses start/end times + run number + kennelTag", () => {
    const e = byRun.get(2452)!;
    expect(e.startTime).toBe("17:00");
    expect(e.endTime).toBe("22:00");
    expect(e.kennelTags).toEqual(["dh3-ae"]);
  });
  it("keeps a trailing theme as the title", () => {
    expect(byRun.get(2440)?.title).toBe("The War Edition");
  });
  it("falls back to the <h5> heading year when the toggle attr is absent", () => {
    const events = parseHareLine(cheerio.load(HARELINE_HEADING_ONLY));
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-04-19"); // year 2026 from "April 2026" heading
  });
});

// ── Detail-page parser ─────────────────────────────────────────────────────────

describe("parseDetailPage", () => {
  it("extracts hares, venue, maps link, and coords when MEC carries a location", () => {
    const d = parseDetailPage(DETAIL_VENUE);
    expect(d.hares).toBe("Thighs Wide Open");
    expect(d.location).toBe("Goose Island Tap House, JVC");
    expect(d.locationUrl).toContain("maps.app.goo.gl");
    expect(d.latitude).toBeCloseTo(25.054545);
    expect(d.longitude).toBeCloseTo(55.20726);
    // Venue-only body → no leftover notes.
    expect(d.description).toBeUndefined();
  });

  it("treats a coord-less body as free-form notes (no venue) and never reads the phone", () => {
    const d = parseDetailPage(DETAIL_NOTES);
    expect(d.hares).toBe("Dyke");
    expect(d.location).toBeUndefined(); // no coords → first paragraph is a note, not a venue
    expect(d.description).toContain("Park in the car park");
    expect(d.description).toContain("Sunday run");
    expect(d.description).not.toContain("+971"); // contact phone is PII, never scraped
    expect(d.description).not.toMatch(/Google Map Link/); // maps anchor stripped from notes
    expect(d.locationUrl).toContain("maps.app.goo.gl");
    expect(d.latitude).toBeUndefined();
  });

  it("returns {} for a listing page with no detail markup", () => {
    expect(parseDetailPage(HOME_HTML)).toEqual({});
  });
});

// ── Adapter integration (fetch) ────────────────────────────────────────────────

describe("DesertHashAdapter.fetch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merges both surfaces and returns clean events", async () => {
    mockTwoSurfaces(HOME_HTML, HARELINE_HTML);
    // Wide window so the fixed-date fixtures stay in-window regardless of wall clock.
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    const runs = result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(runs).toEqual([2440, 2452, 2456, 2457]); // upcoming + 3 deduped/filtered recent
    expect(result.errors).toHaveLength(0);
    expect(result.events.every((e) => e.kennelTags[0] === "dh3-ae")).toBe(true);
  });

  it("enriches the upcoming run with detail-page hares / venue / maps / coords", async () => {
    mockSurfacesWithDetails(HOME_HTML, HARELINE_HTML, { "dh3-run-2457": DETAIL_VENUE });
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    const e = result.events.find((ev) => ev.runNumber === 2457);
    expect(e?.hares).toBe("Thighs Wide Open");
    expect(e?.location).toBe("Goose Island Tap House, JVC");
    expect(e?.locationUrl).toContain("maps.app.goo.gl");
    expect(e?.latitude).toBeCloseTo(25.054545);
    expect(result.errors).toHaveLength(0);
  });

  it("captures coord-less notes as description and never leaks the phone", async () => {
    mockSurfacesWithDetails(HOME_HTML, HARELINE_HTML, { "dh3-run-2457": DETAIL_NOTES });
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    const e = result.events.find((ev) => ev.runNumber === 2457);
    expect(e?.hares).toBe("Dyke");
    expect(e?.description).toContain("Park in the car park");
    expect(e?.location).toBeUndefined();
    expect(e?.description).not.toContain("+971");
    expect(result.errors).toHaveLength(0);
  });

  it("survives a detail-page fetch failure without failing the scrape, but surfaces systemic loss", async () => {
    // Detail fetches 503 while listing surfaces succeed → events still returned,
    // just un-enriched; reconcile must NOT be suppressed (errors[] stays empty),
    // but the total enrichment loss is surfaced via errorDetails (Codex review).
    let call = 0;
    mockedSafeFetch.mockImplementation((url: string) => {
      const u = String(url);
      const isListing = u === "https://www.deserthash.org/" || u.includes("page_id=5152");
      call++;
      if (isListing) {
        const html = u.includes("page_id=5152") ? HARELINE_HTML : HOME_HTML;
        return Promise.resolve({
          ok: true, status: 200, statusText: "OK",
          text: () => Promise.resolve(html), headers: new Headers(),
        } as Response);
      }
      return Promise.resolve({
        ok: false, status: 503, statusText: "Service Unavailable",
        text: () => Promise.resolve(""), headers: new Headers(),
      } as Response);
    });
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    expect(result.events.length).toBeGreaterThan(0);
    // errors[] empty → status SUCCESS, reconcile of the healthy listing runs.
    expect(result.errors).toHaveLength(0);
    expect(call).toBeGreaterThan(2); // listing + at least one detail attempt
    // …but the all-detail-failure is recorded in errorDetails for the audit pipeline,
    // both as the systemic summary AND the structured per-fetch failure records.
    expect(result.errorDetails?.parse?.some((p) => /produced no fields for all/.test(p.error))).toBe(true);
    expect(result.errorDetails?.fetch?.length).toBeGreaterThan(0);
    expect(result.diagnosticContext?.detailFetchFailures).toBeGreaterThan(0);
  });

  it("surfaces systemic loss when detail pages 200-OK but parse to nothing (markup drift)", async () => {
    // Every detail fetch returns a 200 page with NO detail markup (parses to {}):
    // detailFetchFailures stays 0, but detailsEnriched === 0 → still flagged.
    mockedSafeFetch.mockImplementation((url: string) => {
      const u = String(url);
      const html = u.includes("page_id=5152")
        ? HARELINE_HTML
        : u.includes("mec-events=")
          ? "<html><body><div>no detail markup here</div></body></html>"
          : HOME_HTML;
      return Promise.resolve({
        ok: true, status: 200, statusText: "OK",
        text: () => Promise.resolve(html), headers: new Headers(),
      } as Response);
    });
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0); // reconcile not suppressed
    expect(result.diagnosticContext?.detailFetchFailures).toBe(0); // no HTTP failures
    expect(result.diagnosticContext?.detailsEnriched).toBe(0);
    expect(result.errorDetails?.parse?.some((p) => /produced no fields for all/.test(p.error))).toBe(true);
  });

  it("does not flag systemic failure when detail enrichment succeeds", async () => {
    mockSurfacesWithDetails(HOME_HTML, HARELINE_HTML, { "dh3-run-2457": DETAIL_VENUE });
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    expect(result.errors).toHaveLength(0);
    expect(result.errorDetails?.parse?.some((p) => /produced no fields for all/.test(p.error)))
      .toBeFalsy();
  });

  it("fail-loud guard: 0 DH3 runs parsed → errors[]", async () => {
    mockTwoSurfaces(NO_RUNS_HTML, NO_RUNS_HTML);
    const result = await new DesertHashAdapter().fetch(makeSource(), { days: 40000 });
    expect(result.events).toHaveLength(0);
    expect(result.errors.join(" ")).toMatch(/parsed 0 DH3 runs/);
  });

  it("surfaces a fetch failure rather than a silent empty scrape", async () => {
    mockedSafeFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
      headers: new Headers(),
    } as Response);
    const result = await new DesertHashAdapter().fetch(makeSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
