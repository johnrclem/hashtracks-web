import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, fetchBrowserRenderedPage } from "../utils";

/**
 * Hogtown H3 (Toronto) — Google Sites SPA at hogtownh3.com. Resolves
 * issue #1331: replaces the Meetup adapter's three recycled template
 * titles ("Saturday afternoon run/walk and beer with HH3", etc.) with
 * the website's per-event hash names, run numbers, hares, and costs.
 *
 * The kennel runs THREE concurrent sub-series under one Meetup group:
 *   - HOGTOWN (Saturdays, biweekly) — primary run-number sequence
 *   - TWAT    (Toronto Women's Alternative Thursdays, monthly)
 *   - HOGANS  (Fridays, monthly)
 * Each has its own counter. The HashTracks schema doesn't have a
 * sub-series field (per #1331's "otherwise leave them all on the same
 * kennel and let the title carry the prefix" guidance), so the parser
 * embeds the series label into the title.
 *
 * Sourcing: `/upcoming-trails` carries the next ~3 months. The Google
 * Sites shell is JS-rendered (verified: raw curl returns zero hits for
 * "HOGTOWN" / "Hare:"), so this adapter goes through the NAS
 * browser-render service.
 */

const BASE_URL = "https://www.hogtownh3.com";
const UPCOMING_PATH = "/upcoming-trails";
const HOME_PATH = "/";

/** Series prefix detector. Run separately from the title extraction below
 * to keep each regex below the complexity bound — combining series +
 * run-number + title in one regex tripped Sonar S5843 (#1635 review). */
const SERIES_TOKEN_RE = /^(HOGTOWN|HOGANS|TWAT)\s*#?\s*(\d+)/i;
const MEETUP_ID_PREFIX_RE = /^\d+\s*\/\s*/;
const TITLE_DASH_PREFIX_RE = /^\s*[-–]\s*/;
const WEEKDAY_PREFIX_RE = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)/i;
const URL_RE = /https?:\/\/\S+/;
const BARE_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])m/i;

/** Try to extract a label-prefixed value. Case-insensitive label match,
 * skips one optional `:` and any leading whitespace before the value.
 * Returns undefined if none of the labels matched the text's prefix. */
function tryExtractLabel(text: string, ...labels: string[]): string | undefined {
  const lower = text.toLowerCase();
  for (const label of labels) {
    if (!lower.startsWith(label.toLowerCase())) continue;
    const rest = text.slice(label.length).replace(/^\s*:?\s*/, "").trim();
    return rest || undefined;
  }
  return undefined;
}

interface SeriesHeader {
  series: string;
  runNumber: number;
  title: string;
}

/** Parse a trail-header paragraph (e.g., `"Hogtown #2071 - GDU Saves the
 * Day!"` or `"6795/TWAT#582 - Naughty's Birthday Trail"`) into its three
 * components. Returns null if the text isn't a recognizable header. */
function parseSeriesHeader(text: string): SeriesHeader | null {
  const stripped = text.trim().replace(MEETUP_ID_PREFIX_RE, "");
  const m = SERIES_TOKEN_RE.exec(stripped);
  if (!m) return null;
  const runNumber = Number.parseInt(m[2], 10);
  const series = normalizeSeries(m[1]);
  const title = stripped.slice(m[0].length).replace(TITLE_DASH_PREFIX_RE, "").trim();
  return { series, runNumber, title };
}

/** Convert a `BARE_TIME_RE` match to an HH:MM string. */
function buildStartTime(m: RegExpExecArray): string {
  let hours = Number.parseInt(m[1], 10);
  const mins = m[2] ? Number.parseInt(m[2], 10) : 0;
  const ampm = m[3].toLowerCase();
  if (ampm === "p" && hours !== 12) hours += 12;
  if (ampm === "a" && hours === 12) hours = 0;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

interface DraftEntry {
  series: string;
  runNumber: number;
  rawTitle: string;
  dateLine?: string;
  hares?: string;
  location?: string;
  cost?: string;
  sourceUrl?: string;
}

/** Normalize a series token to a consistent display label embedded in the
 * event title. The source mixes casing (Hogtown vs HOGTOWN). */
function normalizeSeries(s: string): string {
  const upper = s.toUpperCase();
  if (upper === "HOGTOWN") return "HOGTOWN";
  if (upper === "HOGANS") return "HOGANS";
  if (upper === "TWAT") return "TWAT";
  return upper;
}

/** Read every `<p>` element in document order, returning its trimmed text
 * with ` ` (NBSP) collapsed to regular spaces. Defensive against
 * Google Sites rotating its `zfr3Q`-style class names — we key on content
 * shape, not class. */
function collectParagraphs(html: string): string[] {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const out: string[] = [];
  $("p").each((_i, el) => {
    const text = $(el).text().replaceAll(/\s+/g, " ").trim();
    if (text) out.push(text);
  });
  return out;
}

/** Convert a draft entry (header + label/value paragraphs) into a
 * RawEventData. Returns null if the date line couldn't be parsed. */
function finalizeEntry(d: DraftEntry, sourcePageUrl: string): RawEventData | null {
  if (!d.dateLine) return null;

  // Hogtown writes "Saturday, May 23, 2026, 5pm" — split the time off so
  // chrono-node sees a clean date part. Sliced via indexOf rather than a
  // strip-regex to keep this file under the Sonar S5852 ReDoS threshold.
  const timeMatch = BARE_TIME_RE.exec(d.dateLine);
  const datePart = timeMatch
    ? d.dateLine.slice(0, timeMatch.index).replace(/,\s*$/, "").trim()
    : d.dateLine.trim();
  const dateStr = chronoParseDate(datePart, "en-US");
  if (!dateStr) return null;

  const startTime = timeMatch ? buildStartTime(timeMatch) : undefined;

  // Title: "<SERIES> #N - <name>" — preserves the sub-series prefix per
  // #1331 spec. Falls back to "<SERIES> #N" when the kennel didn't fill
  // in a name.
  const titleSuffix = d.rawTitle.trim();
  const title = titleSuffix ? `${d.series} #${d.runNumber} - ${titleSuffix}` : `${d.series} #${d.runNumber}`;

  // Treat literal TBD/TBA/TBC strings as "no value yet" — the Meetup link
  // typically fills in later, but we don't want "TBD" in the canonical
  // location field.
  const cleanLocation = d.location && !/^TBD|^TBA|^TBC/i.test(d.location.trim())
    ? d.location.trim()
    : undefined;

  return {
    date: dateStr,
    kennelTags: ["hogtownh3"],
    runNumber: d.runNumber,
    title,
    hares: d.hares?.trim() || undefined,
    location: cleanLocation,
    startTime,
    cost: d.cost?.trim() || undefined,
    sourceUrl: d.sourceUrl ?? sourcePageUrl,
  };
}

/**
 * Parse Hogtown's browser-rendered HTML into RawEventData rows.
 *
 * The page is a flat sequence of `<p>` elements. A series-header
 * paragraph (`Hogtown #2071 - GDU Saves the Day!`) starts a new entry;
 * subsequent paragraphs add fields (date, hare, location, cost, RSVP url)
 * until the next series header or end-of-document.
 *
 * Exported for unit testing.
 */
export function parseHogtownEvents(html: string, sourcePageUrl: string): RawEventData[] {
  const paragraphs = collectParagraphs(html);
  const out: RawEventData[] = [];
  let draft: DraftEntry | null = null;

  const flush = () => {
    if (!draft) return;
    const ev = finalizeEntry(draft, sourcePageUrl);
    if (ev) out.push(ev);
    draft = null;
  };

  for (const p of paragraphs) {
    const header = parseSeriesHeader(p);
    if (header) {
      flush();
      draft = { series: header.series, runNumber: header.runNumber, rawTitle: header.title };
      continue;
    }
    if (!draft) continue;

    if (WEEKDAY_PREFIX_RE.test(p)) {
      draft.dateLine = p;
      continue;
    }
    const hares = tryExtractLabel(p, "Hares:", "Hare:");
    if (hares !== undefined) {
      draft.hares = hares;
      continue;
    }
    const location = tryExtractLabel(p, "Start Location:");
    if (location !== undefined) {
      draft.location = location;
      continue;
    }
    const cost = tryExtractLabel(p, "Cost:");
    if (cost !== undefined) {
      draft.cost = cost;
      continue;
    }
    if (/^RSVP\b/i.test(p)) {
      const url = URL_RE.exec(p);
      if (url) draft.sourceUrl = url[0];
    }
  }
  flush();

  return out;
}

export class HogtownAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url?.replace(/\/$/, "") || BASE_URL;
    const upcomingUrl = `${baseUrl}${UPCOMING_PATH}`;
    const homeUrl = `${baseUrl}${HOME_PATH}`;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const all: RawEventData[] = [];

    for (const [url, label] of [[upcomingUrl, "upcoming-trails"], [homeUrl, "home"]] as const) {
      const result = await fetchBrowserRenderedPage(url, {
        waitFor: "body",
        timezoneId: "America/Toronto",
        timeout: 25000,
      });
      if (!result.ok) {
        const message = `Failed to render ${label}: ${result.result.errors.join("; ") || "browser-render error"}`;
        errors.push(message);
        errorDetails.fetch = [...(errorDetails.fetch ?? []), { url, message }];
        continue;
      }
      const events = parseHogtownEvents(result.html, url);
      all.push(...events);
    }

    // Dedup by (series prefix in title + runNumber) — the home page
    // typically repeats the next trail also on /upcoming-trails. Keep the
    // first occurrence (chronologically ordered on the source).
    const seen = new Set<string>();
    const deduped: RawEventData[] = [];
    for (const ev of all) {
      const key = `${ev.runNumber ?? ""}|${ev.title ?? ""}|${ev.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }

    return {
      events: deduped,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
    };
  }
}
