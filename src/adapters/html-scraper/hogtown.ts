import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  buildDateWindow,
  chronoParseDate,
  decodeEntities,
  fetchBrowserRenderedPage,
  MONTHS,
  stripPlaceholder,
} from "../utils";

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
const SPECIAL_EVENTS_PATH = "/special-events-and-announcements";

/** A campout/special-event entry on /upcoming-trails replaces its
 *  "Start Location:" line with a pointer to the Special Events page
 *  ("Details on Special Events Page here"). Matched case-insensitively. */
const SPECIAL_EVENTS_MARKER_RE = /special events page/i;

const YEAR_RE = /\b(20\d{2})\b/;
/** A campout spans days, not months — reject absurdly wide spans (e.g. a
 *  year-crossing heading parsed with a single year) so they can't match
 *  unrelated entries across the calendar. */
const MAX_SPAN_DAYS = 31;

/** Series prefixes the kennel publishes. Matched via case-insensitive
 * startsWith — see `parseSeriesHeader` — rather than a single
 * alternation regex, which trips Sonar S5852 on its alternation pattern. */
const SERIES_PREFIXES = ["HOGTOWN", "HOGANS", "TWAT"] as const;
const LEADING_DIGITS_RE = /^(\d+)/;
const MEETUP_ID_PREFIX_RE = /^\d+\s*\/\s*/;
const TITLE_DASH_PREFIX_RE = /^\s*[-–]\s*/;
const WEEKDAY_PREFIXES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
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

/** A campout/special-event location pulled from the Special Events page,
 *  keyed by the date span in its heading so the matching /upcoming-trails
 *  entry (whose single date falls inside the span) can adopt it. */
export interface SpecialEventLocation {
  location: string;
  /** Inclusive span as YYYY-MM-DD strings; undefined when the heading had no
   *  parseable date (caller then falls back to the sole-block heuristic). */
  start?: string;
  end?: string;
}

/** Compose a real calendar date as YYYY-MM-DD, or undefined if the month/day
 *  is not a valid date (e.g. "February 30" from a heading typo). */
function toValidYmd(year: number, month1: number, day: number): string | undefined {
  const d = new Date(Date.UTC(year, month1 - 1, day, 12, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month1 - 1 || d.getUTCDate() !== day) {
    return undefined;
  }
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Parse a (month, day) pair list out of a heading, e.g.
 *  "TWAT campout, 2026 EDITION Friday June 19 - Sunday June 21" → June 19 + June 21.
 *  Deterministic token walk against the shared MONTHS map (no month-name
 *  alternation regex — keeps under the Sonar S5843/S5852 complexity bounds).
 *  Returns no span when the dates are invalid or span more than a month
 *  (MAX_SPAN_DAYS) so a malformed/year-crossing heading can't match unrelated
 *  entries. */
function parseDateSpanFromHeading(heading: string): { start?: string; end?: string } {
  const yearMatch = YEAR_RE.exec(heading);
  if (!yearMatch) return {};
  const year = Number.parseInt(yearMatch[1], 10);
  const tokens = heading.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const dates: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const month1 = MONTHS[tokens[i]]; // 1-indexed; undefined when not a month
    if (month1 === undefined) continue;
    const day = Number.parseInt(tokens[i + 1], 10);
    if (!Number.isFinite(day)) continue;
    const ymd = toValidYmd(year, month1, day);
    if (ymd) dates.push(ymd);
  }
  if (dates.length === 0) return {};
  dates.sort((a, b) => a.localeCompare(b));
  const start = dates[0];
  const end = dates[dates.length - 1];
  const spanDays = (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000;
  if (spanDays > MAX_SPAN_DAYS) return {};
  return { start, end };
}

/** Resolve a special-event location for an /upcoming-trails entry whose date
 *  points at the Special Events page — only when a block's date span contains
 *  the entry date. No sole-block fallback: a dateless block must not be glued
 *  onto an arbitrary campout entry (it could attach the wrong venue when two
 *  specials are listed). A missing match degrades to no location, never a
 *  wrong one. */
function resolveSpecialLocation(
  date: string,
  locations: readonly SpecialEventLocation[],
): string | undefined {
  return locations.find(
    (l) => l.start && l.end && date >= l.start && date <= l.end,
  )?.location;
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
  const upper = stripped.toUpperCase();
  const matchedPrefix = SERIES_PREFIXES.find((prefix) => upper.startsWith(prefix));
  if (!matchedPrefix) return null;
  // Skip whitespace + optional `#` + whitespace procedurally so the
  // anchored regex below has no `\s*` quantifier — keeps Sonar S5852
  // off this line.
  let after = stripped.slice(matchedPrefix.length).trimStart();
  if (after.startsWith("#")) after = after.slice(1).trimStart();
  const runMatch = LEADING_DIGITS_RE.exec(after);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);
  const title = after.slice(runMatch[0].length).replace(TITLE_DASH_PREFIX_RE, "").trim();
  return { series: matchedPrefix, runNumber, title };
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
  /** #1932: set when the entry points at the Special Events page for its
   *  venue ("Details on Special Events Page here") instead of a Start
   *  Location line — the real location is resolved from that page. */
  needsSpecialEvents?: boolean;
}

/** Read every <p> element in document order, returning its trimmed text
 * with NBSP/named entities decoded and whitespace collapsed. Defensive
 * against Google Sites rotating its `zfr3Q`-style class names — we key on
 * content shape, not class. */
function collectParagraphs(html: string): string[] {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const out: string[] = [];
  $("p").each((_i, el) => {
    const text = decodeEntities($(el).text()).replaceAll(/\s+/g, " ").trim();
    if (text) out.push(text);
  });
  return out;
}

/** Parse the Special Events page into campout location blocks. Each block is
 *  a heading (carrying the date span) followed by a "Where:"/"Location:"
 *  paragraph. Keyed on content shape, not class names (Google Sites rotates
 *  them). Exported for unit testing. */
export function parseSpecialEventsLocations(html: string): SpecialEventLocation[] {
  const $ = cheerio.load(html);
  $("script, style").remove();
  const out: SpecialEventLocation[] = [];
  let heading = "";
  $("h1, h2, h3, h4, p").each((_i, el) => {
    const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? "";
    const text = decodeEntities($(el).text()).replaceAll(/\s+/g, " ").trim();
    if (!text) return;
    if (tag !== "p") {
      heading = text;
      return;
    }
    const where = tryExtractLabel(text, "Where:", "Location:");
    if (where === undefined) return;
    const venue = stripPlaceholder(where);
    if (!venue) return;
    out.push({ location: venue, ...parseDateSpanFromHeading(heading) });
  });
  return out;
}

/** Convert a draft entry (header + label/value paragraphs) into a
 * RawEventData. Returns null if the date line couldn't be parsed. */
function finalizeEntry(
  d: DraftEntry,
  sourcePageUrl: string,
  specialLocations: readonly SpecialEventLocation[] = [],
): RawEventData | null {
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

  // Drop TBD/TBA placeholder locations through the shared helper — keeps
  // canonical location fields free of "TBD" until the kennel posts the
  // real venue (typically a few days before the trail).
  let cleanLocation = stripPlaceholder(d.location);

  // #1932: campout/special entries point at the Special Events page instead
  // of carrying a Start Location line. Adopt the venue from that page whose
  // date span contains this entry's date.
  if (!cleanLocation && d.needsSpecialEvents) {
    cleanLocation = resolveSpecialLocation(dateStr, specialLocations);
  }

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
/** Apply a single content paragraph to an in-progress draft entry,
 * setting the matching field. Extracted to keep `parseHogtownEvents`
 * under the cognitive-complexity bound (Sonar S3776). */
function applyParagraphToDraft(draft: DraftEntry, p: string): void {
  if (WEEKDAY_PREFIXES.some((w) => p.startsWith(w))) {
    draft.dateLine = p;
    return;
  }
  const hares = tryExtractLabel(p, "Hares:", "Hare:");
  if (hares !== undefined) {
    draft.hares = hares;
    return;
  }
  const location = tryExtractLabel(p, "Start Location:");
  if (location !== undefined) {
    draft.location = location;
    return;
  }
  // #1932: campout entries replace the Start Location line with a pointer to
  // the Special Events page — flag for secondary-page enrichment.
  if (SPECIAL_EVENTS_MARKER_RE.test(p)) {
    draft.needsSpecialEvents = true;
    return;
  }
  const cost = tryExtractLabel(p, "Cost:");
  if (cost !== undefined) {
    draft.cost = cost;
    return;
  }
  if (/^RSVP\b/i.test(p)) {
    const url = URL_RE.exec(p);
    if (url) draft.sourceUrl = url[0];
  }
}

export function parseHogtownEvents(
  html: string,
  sourcePageUrl: string,
  specialLocations: readonly SpecialEventLocation[] = [],
): RawEventData[] {
  const paragraphs = collectParagraphs(html);
  const out: RawEventData[] = [];
  let draft: DraftEntry | null = null;

  const flush = () => {
    if (!draft) return;
    const ev = finalizeEntry(draft, sourcePageUrl, specialLocations);
    if (ev) out.push(ev);
    draft = null;
  };

  for (const p of paragraphs) {
    const header = parseSeriesHeader(p);
    if (header) {
      flush();
      draft = { series: header.series, runNumber: header.runNumber, rawTitle: header.title };
    } else if (draft) {
      applyParagraphToDraft(draft, p);
    }
  }
  flush();

  return out;
}

export class HogtownAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    // Build URLs from the source URL's *origin* — the seeded source.url
    // points at `/upcoming-trails` directly, so naive string concatenation
    // would produce `/upcoming-trails/upcoming-trails`.
    let origin = BASE_URL;
    try {
      if (source.url) origin = new URL(source.url).origin;
    } catch {
      origin = BASE_URL;
    }
    const upcomingUrl = `${origin}${UPCOMING_PATH}`;
    const homeUrl = `${origin}${HOME_PATH}`;
    const specialUrl = `${origin}${SPECIAL_EVENTS_PATH}`;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const all: RawEventData[] = [];

    // #1932: campout entries carry their venue on the Special Events page, not
    // the run list. Fetch it first so the per-entry parse can adopt the venue.
    // A failure here is non-fatal — only campout locations go missing.
    let specialLocations: SpecialEventLocation[] = [];
    const specialResult = await fetchBrowserRenderedPage(specialUrl, {
      waitFor: "body",
      timezoneId: "America/Toronto",
      timeout: 25000,
    });
    if (specialResult.ok) {
      specialLocations = parseSpecialEventsLocations(specialResult.html);
    } else {
      // Non-fatal: a missing Special Events page only costs campout venues.
      console.warn(
        `[hogtown] Special Events page render failed (${specialUrl}): ${specialResult.result.errors.join("; ") || "browser-render error"}`,
      );
    }

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
      const events = parseHogtownEvents(result.html, url, specialLocations);
      all.push(...events);
    }

    // Dedup by (runNumber + title + date) — the home page typically
    // repeats the next trail that's also on /upcoming-trails. Title
    // already carries the series prefix, so cross-series collisions on
    // a shared run number can't happen.
    const seen = new Set<string>();
    const deduped: RawEventData[] = [];
    for (const ev of all) {
      const key = `${ev.runNumber ?? ""}|${ev.title ?? ""}|${ev.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(ev);
    }

    // Honor `options.days` per the adapter-patterns rule: a tight admin
    // re-scrape probe shouldn't pull events outside its requested window.
    // Default to 120 days (matches seed.scrapeDays). minDate is open-ended
    // on the past side — the source itself is upcoming-only.
    const days = options?.days ?? source.scrapeDays ?? 120;
    const { maxDate } = buildDateWindow(days);
    const filtered = deduped.filter((ev) => new Date(ev.date) <= maxDate);

    return {
      events: filtered,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
    };
  }
}
