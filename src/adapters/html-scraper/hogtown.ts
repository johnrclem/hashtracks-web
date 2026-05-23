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

/** Series prefix regex — matches the trail-header line. Case-insensitive
 * because the kennel mixes "Hogtown #" and "HOGTOWN -" capitalization. */
const SERIES_HEADER_RE = /^\s*(?:\d+\s*\/\s*)?(HOGTOWN|HOGANS|TWAT|Hogtown|Hogans|Twat)\s*#?\s*(\d+)\s*[-–]?\s*(.*?)\s*$/;
const WEEKDAY_PREFIX_RE = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)[a-z]*\b/i;
const HARES_LABEL_RE = /^Hares?\s*:\s*(.+)$/i;
const LOCATION_LABEL_RE = /^Start\s+Location\s*:\s*(.+)$/i;
const COST_LABEL_RE = /^Cost\s*:\s*(.+)$/i;
const RSVP_URL_RE = /^RSVP\s+(?:here\s*:?\s*)?(https?:\/\/\S+)/i;
const BARE_TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])m/i;

/** Extract HH:MM start time from a date line like
 * "Saturday, May 23, 2026, 5pm" or "Thursday, April 30, 2026, 7:30pm". */
function extractStartTime(line: string): string | undefined {
  const m = BARE_TIME_RE.exec(line);
  if (!m) return undefined;
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
    const text = $(el).text().replace(/ /g, " ").replace(/\s+/g, " ").trim();
    if (text) out.push(text);
  });
  return out;
}

/** Convert a draft entry (header + label/value paragraphs) into a
 * RawEventData. Returns null if the date line couldn't be parsed. */
function finalizeEntry(d: DraftEntry, sourcePageUrl: string): RawEventData | null {
  if (!d.dateLine) return null;

  // Strip the leading weekday (e.g., "Saturday, May 23, 2026, 5pm") so
  // chrono-node sees a clean "May 23, 2026" plus the time token.
  const dateText = d.dateLine.replace(/\s*,?\s*(\d{1,2}(?::\d{2})?\s*[ap]m)\s*$/i, "").trim();
  const dateStr = chronoParseDate(dateText, "en-US");
  if (!dateStr) return null;

  // Pull the time token from the original line. Hogtown writes both
  // bare-hour ("5pm") and minute-precise ("4:30pm") forms; parse12HourTime
  // requires a colon, so handle the bare form ourselves.
  const startTime = extractStartTime(d.dateLine);

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
    const header = SERIES_HEADER_RE.exec(p);
    if (header) {
      flush();
      draft = {
        series: normalizeSeries(header[1]),
        runNumber: Number.parseInt(header[2], 10),
        rawTitle: header[3] ?? "",
      };
      continue;
    }
    if (!draft) continue;

    if (WEEKDAY_PREFIX_RE.test(p)) {
      draft.dateLine = p;
      continue;
    }
    const haresMatch = HARES_LABEL_RE.exec(p);
    if (haresMatch) {
      draft.hares = haresMatch[1];
      continue;
    }
    const locMatch = LOCATION_LABEL_RE.exec(p);
    if (locMatch) {
      draft.location = locMatch[1];
      continue;
    }
    const costMatch = COST_LABEL_RE.exec(p);
    if (costMatch) {
      draft.cost = costMatch[1];
      continue;
    }
    const rsvpMatch = RSVP_URL_RE.exec(p);
    if (rsvpMatch) {
      draft.sourceUrl = rsvpMatch[1];
      continue;
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
