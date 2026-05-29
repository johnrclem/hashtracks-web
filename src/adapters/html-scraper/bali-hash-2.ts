import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { todayInTimezone } from "@/lib/timezone";
import { safeFetch } from "../safe-fetch";
import {
  chronoParseDate,
  extractHashRunNumber,
  filterEventsByWindow,
  googleMapsSearchUrl,
  normalizeHaresField,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/**
 * Bali Hash House Harriers 2 (`bali-hash-2`) — Ghost 6.5 blog at balihash2.com.
 *
 * Each weekly run is a "Bali Hash 2 Next Run Map - #NNNN - <location> - D-MMM-YY"
 * post. The home-page listing card carries Run / Date / start time / Location in
 * its excerpt; the detail page additionally exposes `GPS:` coords and `Hares:`.
 * The `Occasion:` line is the club slogan ("WE START TOGETHER - WE DRINK
 * TOGETHER"), never a per-run theme, so it is deliberately ignored — titles are
 * left undefined for merge.ts to synthesize `Bali Hash 2 Trail #N`.
 *
 * Parsing is split into pure exported helpers (`parseListingCards`,
 * `parseDetailFields`) so the one-shot history backfill
 * (`scripts/backfill-bali-hash-2-history.ts`) shares one parser, not a fork.
 */

const BASE_URL = "https://balihash2.com/";
const KENNEL_TAG = "bali-hash-2";
/** Run-post slug marker — distinguishes trail posts from About/static pages. */
const POST_HREF_RE = /\/bali-hash-2-next-run-map-/i;
/** `30-May-26` / `4-Apr-26` — hyphenated D-MMM-YY (single- or two-digit day).
 *  A simple linear regex (ReDoS-safe, no alternation complexity) captures the
 *  month token; parseBaliDate validates it against VALID_MONTHS so non-month
 *  words ("30-Marching-26") can't slip through to chrono. */
const RUN_DATE_RE = /(\d{1,2})-([A-Za-z]+)-(\d{2,4})/;
const VALID_MONTHS = new Set([
  "jan", "january", "feb", "february", "mar", "march", "apr", "april",
  "may", "jun", "june", "jul", "july", "aug", "august", "sep", "sept",
  "september", "oct", "october", "nov", "november", "dec", "december",
]);
/** Cap detail-page fetches per scrape so a wide window doesn't fan out. */
const DEFAULT_DETAIL_FETCH_CAP = 10;
const DEFAULT_DAYS = 90;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

/** One run post discovered on the listing page. */
export interface BaliListingEntry {
  runNumber?: number;
  /** YYYY-MM-DD (local run date). */
  date?: string;
  startTime?: string;
  location?: string;
  url: string;
  /** DOM order on the listing (0 = newest, reverse-chronological). */
  domIndex: number;
}

/** Detail-page enrichment fields. */
export interface BaliDetailFields {
  latitude?: number;
  longitude?: number;
  hares?: string;
  location?: string;
  startTime?: string;
  date?: string;
}

/** Parse `30-May-26` → `2026-05-30`. Normalizes hyphens to spaces so the
 *  chrono `D MMM YY` fast-path fires (avoids the single-digit-day mis-parse). */
export function parseBaliDate(text: string): string | undefined {
  const m = RUN_DATE_RE.exec(text);
  if (!m || !VALID_MONTHS.has(m[2].toLowerCase())) return undefined;
  const normalized = `${m[1]} ${m[2]} ${m[3]}`;
  return chronoParseDate(normalized, "en-US") ?? undefined;
}

/** Extract the run number, preferring the title `#NNNN` then the `Run:` line. */
function parseRunNumber(title: string, excerpt: string): number | undefined {
  return extractHashRunNumber(title) ?? extractHashRunNumber(`#${matchRun(excerpt) ?? ""}`);
}

function matchRun(text: string): string | undefined {
  return /Run:\s*(\d+)/i.exec(text)?.[1];
}

/** Pull the start time from "...start promptly at: 4:00 PM..." (falls back to
 *  the first 12-hour time anywhere in the text). */
function parseStartTime(text: string): string | undefined {
  const promptly = /promptly at:\s*(\d{1,2}:\d{2}\s*(?:am|pm))/i.exec(text);
  if (promptly) return parse12HourTime(promptly[1]);
  return parse12HourTime(text);
}

/** Strip a leading list bullet ("* ", "• ", "- ") from a captured value. */
function stripLeadingBullet(value: string): string {
  return value.replace(/^[*•\-\s]+/, "").trim();
}

/** Extract the `Location:` value from listing/detail text (single line). */
function parseLocation(text: string): string | undefined {
  const m = /Location:\s*([^\n]+)/i.exec(text);
  if (!m) return undefined;
  const cleaned = stripLeadingBullet(m[1]);
  return cleaned.length >= 2 ? cleaned : undefined;
}

/**
 * Parse the home-page (or archive page) HTML into listing entries. Exported so
 * the backfill walks archive pages with the same parser.
 */
export function parseListingCards(html: string): BaliListingEntry[] {
  const $ = cheerio.load(html);
  const entries: BaliListingEntry[] = [];
  const links = $("a.gh-card-link, article.gh-card a").toArray();

  let domIndex = 0;
  const seenUrls = new Set<string>();
  for (const el of links) {
    const link = $(el);
    const href = link.attr("href");
    if (!href || !POST_HREF_RE.test(href)) continue;
    const url = new URL(href, BASE_URL).toString();
    if (seenUrls.has(url)) continue;
    seenUrls.add(url);

    const title = link.find("h1, h2, h3, .gh-card-title").first().text().trim();
    const excerpt = link.find(".gh-card-excerpt, p").first().text().trim();

    entries.push({
      runNumber: parseRunNumber(title, excerpt),
      date: parseBaliDate(excerpt) ?? parseBaliDate(title),
      startTime: parseStartTime(excerpt),
      location: parseLocation(excerpt),
      url,
      domIndex: domIndex++,
    });
  }
  return entries;
}

/**
 * Parse a detail page's `section.gh-content` body for GPS / hares / location /
 * date / start time. Coordinates are emitted only when BOTH halves of the pair
 * are finite and the pair is not the (0,0) null island.
 */
export function parseDetailFields(html: string): BaliDetailFields {
  const $ = cheerio.load(html);
  const section = $("section.gh-content, .gh-content, .post-content").first();
  const sectionHtml = (section.length ? section : $("body")).html() ?? "";
  // Ghost renders run details as a <p> (Run/Date/start, <br>-separated) plus a
  // <ul><li> block (Location/GPS/Occasion/Hares). stripHtmlTags turns <br> and
  // closing block tags into newlines so the single-line field regexes below
  // stop at each value instead of running past it into the next <li>.
  const text = stripHtmlTags(sectionHtml, "\n");

  const fields: BaliDetailFields = {
    location: parseLocation(text),
    startTime: parseStartTime(text),
    date: parseBaliDate(/Date:\s*([^\n]+)/i.exec(text)?.[1] ?? ""),
  };

  const hareMatch = /Hares:\s*([^\n]+)/i.exec(text);
  if (hareMatch) {
    const hares = normalizeHaresField(hareMatch[1].trim());
    if (hares) fields.hares = hares;
  }

  const gps = /GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i.exec(text);
  if (gps) {
    const lat = Number.parseFloat(gps[1]);
    const lng = Number.parseFloat(gps[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0)) {
      fields.latitude = lat;
      fields.longitude = lng;
    }
  }
  return fields;
}

/**
 * Dedupe by run number keeping the first DOM occurrence (newest first on a
 * reverse-chronological Ghost listing), which is the most-recently-published
 * post — corrected reposts (e.g. #1739 appears twice with different times) get
 * the corrected slug `…-2`, published later, listed higher. Entries without a
 * run number are kept as-is (they cannot be deduped).
 */
export function dedupeByRunNumber(entries: BaliListingEntry[]): BaliListingEntry[] {
  const sorted = [...entries].sort((a, b) => a.domIndex - b.domIndex);
  const seen = new Set<number>();
  const out: BaliListingEntry[] = [];
  for (const e of sorted) {
    if (e.runNumber === undefined) {
      out.push(e);
      continue;
    }
    if (seen.has(e.runNumber)) continue;
    seen.add(e.runNumber);
    out.push(e);
  }
  return out;
}

async function fetchDetailFields(url: string): Promise<BaliDetailFields | null> {
  try {
    const res = await safeFetch(url, { headers: REQUEST_HEADERS });
    if (!res.ok) return null;
    return parseDetailFields(await res.text());
  } catch {
    return null;
  }
}

/** Combine a listing entry with optional detail-page enrichment into a
 *  RawEventData. Exported so the one-shot history backfill shares it. */
export function buildEvent(entry: BaliListingEntry, detail: BaliDetailFields | null): RawEventData {
  const location = detail?.location ?? entry.location;
  const event: RawEventData = {
    date: entry.date!,
    kennelTags: [KENNEL_TAG],
    runNumber: entry.runNumber,
    // title left undefined → merge.ts synthesizes "Bali Hash 2 Trail #N".
    startTime: detail?.startTime ?? entry.startTime,
    location,
    locationUrl: location ? googleMapsSearchUrl(location) : undefined,
    hares: detail?.hares,
    sourceUrl: entry.url,
  };

  if (detail) {
    if (detail.latitude !== undefined && detail.longitude !== undefined) {
      event.latitude = detail.latitude;
      event.longitude = detail.longitude;
    } else {
      // Fetched the detail page but found no valid GPS — clear any stale
      // cached coord so a previous good pin isn't wired to a now-blank run.
      event.dropCachedCoords = true;
    }
  }
  return event;
}

export class BaliHash2Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || BASE_URL;
    const days = options?.days ?? source.scrapeDays ?? DEFAULT_DAYS;
    const errorDetails: ErrorDetails = {};

    let html: string;
    try {
      const res = await safeFetch(baseUrl, { headers: REQUEST_HEADERS });
      if (!res.ok) {
        const message = `HTTP ${res.status}: ${res.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: res.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await res.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }

    const structureHash = generateStructureHash(html);
    const allEntries = parseListingCards(html);

    // Fail loud: a 200 with no run posts must NOT yield 0 events silently —
    // the reconciler would cancel every live run. Surface it as an error.
    if (allEntries.length === 0) {
      return {
        events: [],
        errors: ["No Bali Hash 2 run posts found on listing page"],
        structureHash,
        diagnosticContext: { fetchMethod: "html-scrape", postsFound: 0 },
      };
    }

    const deduped = dedupeByRunNumber(allEntries);
    const dated = deduped.filter(
      (e): e is BaliListingEntry & { date: string } => e.date !== undefined,
    );
    const inWindow = filterEventsByWindow(dated, days);

    // Prioritize detail fetches: future runs first, then most-recent, up to cap.
    // Bali is Asia/Makassar (UTC+8) — use the in-zone date so a late-evening run
    // isn't mis-bucketed against a UTC "today".
    const today = todayInTimezone("Asia/Makassar");
    const detailTargets = [...inWindow]
      .sort((a, b) => {
        const aFuture = a.date >= today;
        const bFuture = b.date >= today;
        if (aFuture !== bFuture) return aFuture ? -1 : 1;
        return b.date.localeCompare(a.date);
      })
      .slice(0, DEFAULT_DETAIL_FETCH_CAP);

    // Fetch the capped detail set concurrently (independent GETs, daily scrape).
    const detailByUrl = new Map(
      await Promise.all(
        detailTargets.map(async (e) => [e.url, await fetchDetailFields(e.url)] as const),
      ),
    );

    const events = inWindow.map((entry) => buildEvent(entry, detailByUrl.get(entry.url) ?? null));

    return {
      events,
      errors: [],
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: allEntries.length,
        afterDedupe: deduped.length,
        inWindow: inWindow.length,
        detailsFetched: detailTargets.length,
        eventsParsed: events.length,
      },
    };
  }
}
