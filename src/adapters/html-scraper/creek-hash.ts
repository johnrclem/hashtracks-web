/**
 * Creek Hash House Harriers (Dubai, UAE) — "Creek H3" / `ch3-ae` — HTML Scraper
 *
 * HashTracks' second United Arab Emirates source and the sister kennel of the
 * already-live Desert H3. creekhash.org is a self-hosted WordPress site. Its WP
 * REST surface (`/wp-json/wp/v2/posts`) returns 404, so there is no config-only
 * path — this is a static Cheerio scrape of two SSR'd surfaces:
 *
 *   1. Home page (https://www.creekhash.org/) — the "This Week's Meet Point"
 *      flexslider. Each `li.slide` carries an `<a href="?p=NNNNN">` (the detail
 *      page) and a `.flex-caption h3` title of the shape
 *      `<ordinal> <Month> <YYYY> – Run <N> – <venue>` (en-dash separated).
 *   2. Detail page (`?p=NNNNN`) — `.entry-content` `<p><strong>Label:</strong>
 *      value</p>` rows: Time, Run No, Location, Hares, plus a "Google Maps Link"
 *      `<a href>`.
 *
 * DATE: parsed from the post TITLE (`<ordinal> Month YYYY`, year-bearing — no
 * inference). The body `Date:` line carries weekday/day-number typos (e.g.
 * "Thursday 26th June 2026" for a 25 Jun Thursday run) and is deliberately
 * ignored. Dates are stored UTC-noon "YYYY-MM-DD"; times "HH:MM".
 *
 * RUN FILTER: a run number is only emitted when the middle title segment matches
 * `Run <N>`. Special-run series in the same archive ("Spit Roast 3", etc.) use a
 * non-"Run" label in that slot and are skipped.
 *
 * PII: the detail page carries a "Contact if lost: <name> – <phone>" line. Only
 * the Time / Location / Hares labels are read; the contact line is never parsed,
 * and `stripContactPII` strips any trailing phone fragment from the hares value
 * as defense in depth. The contact phone is never stored.
 */

import type { Source } from "@/generated/prisma/client";
import * as cheerio from "cheerio";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, applyDateWindow, type FetchHTMLResult } from "../utils";

const HOME_URL = "https://www.creekhash.org/";
const KENNEL_TAG = "ch3-ae";
const DEFAULT_SCRAPE_DAYS = 365;

const MONTHS = new Map<string, number>([
  ["january", 1], ["february", 2], ["march", 3], ["april", 4],
  ["may", 5], ["june", 6], ["july", 7], ["august", 8],
  ["september", 9], ["october", 10], ["november", 11], ["december", 12],
]);

// Title segments are separated by an en-dash/em-dash (`&#8211;` → "–"). Splitting
// on the bare dash only (never an ASCII hyphen) preserves hyphenated place names
// like "Al-Quoz" inside the venue segment; segments are trimmed after the split,
// so no surrounding-whitespace quantifiers are needed (avoids regex backtracking).
const SEGMENT_SEP_RE = /[–—]/;
// Strip an ordinal suffix off a day number ("25th" → "25") before date parse.
const ORDINAL_RE = /(\d)(?:st|nd|rd|th)\b/gi;
// Loose "D Month YYYY" — month validated via Map, not a 12-way alternation.
const DMY_TEXT_RE = /\b(\d{1,2})\s+([A-Za-z]{3,12})\s+(\d{4})\b/;
const RUN_SEGMENT_RE = /^run\s+(\d+)$/i;
const TIME_RE = /(\d{1,2}):(\d{2})/;
// A trailing "– 055 5011504" phone fragment (dash-led digit run). Used only to
// scrub the hares value; never applied to fields that legitimately carry digits
// (e.g. a "Villa 3B" location). The leading space is bounded (` ?`) and the only
// unbounded repetition is the final digit class, so there is no super-linear
// backtracking (the class deliberately excludes `\s`; phone inner spaces are " ").
const PHONE_TAIL_RE = /[–—-] ?\d[\d ()+.-]{4,}$/;

const DETAIL_LABELS_TO_READ = new Set(["time", "location", "hares"]);

// ---------------------------------------------------------------------------
// Pure parse helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/** Build a UTC-noon "YYYY-MM-DD" string from numeric components, or null. */
export function isoDate(year: number, month: number, day: number): string | null {
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Reject impossible calendar dates ("31st June", "30th February"). Without this,
  // the merge path's parseUtcNoonDate would roll an overflow onto a different real
  // day (31 Jun → 1 Jul), silently moving the run — the opposite of why we trust
  // the title date in the first place. Round-trip through Date to validate.
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Normalize a single clock string ("7:05" / "19:00") to "HH:MM", or undefined. */
export function parseClock(text: string | null | undefined): string | undefined {
  if (!text) return undefined;
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  const h = Number.parseInt(m[1], 10);
  const min = Number.parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Parse a title's first segment ("25th June 2026") into a UTC-noon date, or null. */
export function parseTitleDate(text: string): string | null {
  const stripped = text.replace(ORDINAL_RE, "$1");
  const m = DMY_TEXT_RE.exec(stripped);
  if (!m) return null;
  const month = MONTHS.get(m[2].toLowerCase());
  if (!month) return null;
  return isoDate(Number.parseInt(m[3], 10), month, Number.parseInt(m[1], 10));
}

/**
 * Parse a slide/listing title `<ordinal> <Month> <YYYY> – Run <N> – <venue>`.
 * Returns null unless the date parses AND the middle segment is `Run <N>` (drops
 * "Spit Roast N" and other special-run labels). Venue is the remaining segment(s)
 * joined; `title` is intentionally never derived (merge synthesizes the title).
 */
export function parseRunTitle(
  text: string,
): { date: string; runNumber: number; venue?: string } | null {
  const clean = text.replace(/\s+/g, " ").trim();
  const segs = clean.split(SEGMENT_SEP_RE).map((s) => s.trim());
  if (segs.length < 2) return null;
  const date = parseTitleDate(segs[0]);
  if (!date) return null;
  const runMatch = RUN_SEGMENT_RE.exec(segs[1]);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);
  const venue = segs.slice(2).join(" – ").trim();
  return { date, runNumber, venue: venue.length > 0 ? venue : undefined };
}

/** Strip a trailing "– <phone>" fragment from a hares value (PII defense). */
export function stripContactPII(value: string): string {
  return value.replace(PHONE_TAIL_RE, "").trim();
}

export interface DetailFields {
  startTime?: string;
  location?: string;
  hares?: string;
  locationUrl?: string;
}

/**
 * Read the labeled `<p><strong>Label:</strong> value</p>` rows from a detail
 * page's `.entry-content`. Only the Time / Location / Hares labels are consumed;
 * the "Contact if lost" and "Directions" rows are never read (PII / prose). The
 * "Google Maps Link" anchor's href becomes `locationUrl`.
 */
export function parseDetailFields($: cheerio.CheerioAPI): DetailFields {
  // Collapse whitespace runs (incl. non-breaking spaces: WordPress/TinyMCE emit
  // `&nbsp;` around labels). JS `\s` matches U+00A0, so `\s+` normalizes them too.
  const clean = (t: string) => t.replace(/\s+/g, " ").trim();
  const labels = new Map<string, string>();
  $(".entry-content p").each((_i, el) => {
    const $p = $(el);
    const $strong = $p.find("strong").first();
    if ($strong.length === 0) return;
    const label = clean($strong.text()).replace(/:\s*$/, "").toLowerCase();
    if (!DETAIL_LABELS_TO_READ.has(label)) return;
    const full = clean($p.text());
    const strongText = clean($strong.text());
    const value = (full.startsWith(strongText) ? full.slice(strongText.length) : full)
      .replace(/^:?\s*/, "")
      .trim();
    if (value.length > 0) labels.set(label, value);
  });

  const haresRaw = labels.get("hares");
  const hares = haresRaw ? stripContactPII(haresRaw) : undefined;

  // Match any Google Maps host (goo.gl/maps, maps.app.goo.gl, google.com/maps —
  // all contain "maps") by href, or a "maps" anchor label, first one wins.
  let locationUrl: string | undefined;
  $(".entry-content a").each((_i, el) => {
    if (locationUrl) return;
    const href = $(el).attr("href");
    if (!href) return;
    if (/maps/i.test(href) || clean($(el).text()).toLowerCase().includes("maps")) {
      locationUrl = href;
    }
  });

  return {
    startTime: parseClock(labels.get("time")),
    location: labels.get("location"),
    hares: hares && hares.length > 0 ? hares : undefined,
    locationUrl,
  };
}

export interface HomeSlide {
  date: string;
  runNumber: number;
  venue?: string;
  detailUrl: string;
}

/** Parse the home "This Week's Meet Point" flexslider into slide descriptors. */
export function parseHomeSlides($: cheerio.CheerioAPI, baseUrl = HOME_URL): HomeSlide[] {
  const byRun = new Map<number, HomeSlide>();
  $(".flexslider li.slide, .flexslider .slides li").each((_i, el) => {
    const $li = $(el);
    const href = $li.find('a[href*="?p="]').first().attr("href");
    if (!href) return;
    const titleText = $li.find(".flex-caption h3, .flex-caption").first().text();
    const parsed = parseRunTitle(titleText);
    if (!parsed) return;
    let detailUrl = href;
    try {
      detailUrl = new URL(href, baseUrl).href;
    } catch {
      /* keep href as-is if it is already absolute / unparseable-relative */
    }
    byRun.set(parsed.runNumber, { ...parsed, detailUrl });
  });
  return [...byRun.values()];
}

function buildEvent(slide: HomeSlide, detail: DetailFields): RawEventData {
  return {
    date: slide.date,
    kennelTags: [KENNEL_TAG],
    runNumber: slide.runNumber,
    // title intentionally omitted — merge synthesizes "Creek H3 Trail #N".
    startTime: detail.startTime,
    location: detail.location ?? slide.venue,
    hares: detail.hares,
    locationUrl: detail.locationUrl,
    sourceUrl: slide.detailUrl,
  };
}

/**
 * Fetch + parse one slide's detail page. A detail-fetch failure or parse error is
 * recorded but non-fatal: the slide title already carries date+run#+venue, so the
 * event still emits (leaner). Extracted from fetch() to keep its complexity low.
 */
function collectDetail(
  detailPage: FetchHTMLResult,
  slide: HomeSlide,
  errors: string[],
  errorDetails: ErrorDetails,
): { detail: DetailFields; fetchDurationMs: number } {
  if (!detailPage.ok) {
    errors.push(...detailPage.result.errors.map((e) => `Detail ${slide.runNumber}: ${e}`));
    const fetchErrs = detailPage.result.errorDetails?.fetch;
    if (fetchErrs) {
      errorDetails.fetch ??= [];
      errorDetails.fetch.push(...fetchErrs);
    }
    return { detail: {}, fetchDurationMs: 0 };
  }
  try {
    return { detail: parseDetailFields(detailPage.$), fetchDurationMs: detailPage.fetchDurationMs };
  } catch (err) {
    errors.push(`Detail ${slide.runNumber} parse error: ${err}`);
    errorDetails.parse ??= [];
    errorDetails.parse.push({ row: slide.runNumber, section: "detail", error: String(err) });
    return { detail: {}, fetchDurationMs: detailPage.fetchDurationMs };
  }
}

export class CreekHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    let baseUrl = source.url || HOME_URL;
    if (baseUrl.startsWith("//")) baseUrl = `https:${baseUrl}`;
    else if (!/^https?:\/\//i.test(baseUrl)) baseUrl = HOME_URL;

    const homePage = await fetchHTMLPage(baseUrl);
    if (!homePage.ok) return homePage.result;

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let fetchDurationMs = homePage.fetchDurationMs;
    const events: RawEventData[] = [];

    const slides = parseHomeSlides(homePage.$, baseUrl);
    for (const slide of slides) {
      const detailPage = await fetchHTMLPage(slide.detailUrl);
      const collected = collectDetail(detailPage, slide, errors, errorDetails);
      fetchDurationMs += collected.fetchDurationMs;
      events.push(buildEvent(slide, collected.detail));
    }

    // Zero-row fail-loud guard: brand-new single source, baseline fill-rate 0.
    // Without it a silent `events: []` would let reconcile.ts proceed on partial
    // data and false-CANCEL the backfilled archive. Only fire when no fetch/parse
    // error already surfaced (those make the scrape fail loud on their own).
    if (events.length === 0 && !hasAnyErrors(errorDetails)) {
      const message =
        "Creek H3 scraper parsed 0 runs — possible 'This Week's Meet Point' format drift";
      errors.push(message);
      errorDetails.parse ??= [];
      errorDetails.parse.push({ row: 0, error: message });
    }

    const result: ScrapeResult = {
      events,
      errors,
      structureHash: homePage.structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: { eventsParsed: events.length, fetchDurationMs },
    };

    return applyDateWindow(result, options?.days ?? source.scrapeDays ?? DEFAULT_SCRAPE_DAYS);
  }
}
