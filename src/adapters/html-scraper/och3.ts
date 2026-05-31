import type * as cheerio from "cheerio";
import { load as cheerioLoad } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
} from "../types";
import { chronoParseDate, fetchHTMLPage, isPlaceholder, stripHtmlTags, stripZeroWidth } from "../utils";

const DAYS_OF_WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Parse a UK-format date from OCH3 run list text using chrono-node.
 * Handles: "Sunday 22nd February 2026", "22/02/2026", "22 February 2026", etc.
 * Year-less dates require a fallbackYear to produce a result.
 */
export function parseOCH3Date(text: string, fallbackYear?: number): string | null {
  const ref = fallbackYear
    ? new Date(Date.UTC(fallbackYear, 0, 1)) // Jan 1 of fallback year
    : undefined;
  const result = chronoParseDate(text, "en-GB", ref);
  if (!result) return null;
  // If text has no explicit year and no fallbackYear was provided, return null.
  // This preserves behavior: year-less dates require context from earlier entries.
  // Checks: 4-digit year ("2026"), slash-form ("22/02/26"), or text-form 2-digit year ("February 26")
  if (!fallbackYear && !/\b\d{4}\b/.test(text) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(text) && !/[a-z]\s+\d{2}\b/i.test(text)) {
    return null;
  }
  return result;
}

/**
 * Extract the day of week from text, returning the lowercase day name.
 * "Sunday 22nd February 2026" → "sunday"
 */
export function extractDayOfWeek(text: string): string | null {
  const lower = text.toLowerCase();
  for (const day of DAYS_OF_WEEK) {
    if (lower.includes(day)) return day;
  }
  return null;
}

/**
 * Determine start time from day of week.
 * OCH3 alternates: Sunday = 11:00 AM, Monday = 7:30 PM.
 */
export function getStartTimeForDay(dayOfWeek: string | null): string {
  if (dayOfWeek === "sunday") return "11:00";
  if (dayOfWeek === "monday") return "19:30";
  return "11:00"; // default to Sunday time
}

/**
 * Infer day-of-week from an ISO date string (e.g., "2026-04-06" → "monday").
 * Used as fallback when the run-list text has no day name prefix.
 */
export function inferDayFromDate(dateStr: string): string | null {
  const d = new Date(dateStr + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  return DAYS_OF_WEEK[d.getUTCDay()] ?? null;
}

/**
 * Parse dot-notation time "19.30" → "19:30".
 * Returns undefined for invalid or absent times.
 */
export function parseDotTime(text: string): string | undefined {
  const match = /(\d{1,2})\.(\d{2})/.exec(text);
  if (!match) return undefined;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return `${hours.toString().padStart(2, "0")}:${match[2]}`;
}

/** Data extracted from the next-run-details page. */
export interface DetailPageData {
  date: string | null;
  runNumber?: number;
  startTime?: string;
  location?: string;
  hares?: string;
  latitude?: number;
  longitude?: number;
  onInn?: string;
  sourceUrl: string;
}

// The Weebly detail DOM sometimes packs the hare name and the on-after "On
// Inn …" line into one text node with no separator ("Phil 'Layby' MackOn Inn
// will be - The Skimmington…", #1815). Clip the hare at the first "On Inn"
// occurrence — no leading `\b`, so the no-space "MackOn Inn" boundary splits —
// then drop any dangling trailing separator.
const ON_INN_BOUNDARY_RE = /On\s+Inns?\b/i;
export function splitHareFromOnInn(hares: string): string {
  const m = ON_INN_BOUNDARY_RE.exec(hares);
  const clipped = m ? hares.slice(0, m.index) : hares;
  return clipped.replace(/[\s,;-]+$/, "").trim();
}

/**
 * Parse the OCH3 next-run-details page into structured data.
 * Extracts run number, time, venue, hares, On Inn, and map coordinates.
 */
export function parseDetailPage($: cheerio.CheerioAPI, detailUrl: string): DetailPageData | null {
  // Convert each .paragraph to text with <br> rendered as a newline. The site
  // wraps content in a single .paragraph div with inline <strong>/<span>/<b>
  // tags AND hard <br> breaks, e.g. "…RH1 4EU<br/>Ha</strong><strong>re:…".
  // Stripping tags after the <br>→\n substitution makes the break a real line
  // boundary (so the Venue capture stops there instead of swallowing "Ha") while
  // tag-split fragments rejoin with no separator ("<b>H</b>are:" → "Hare:"),
  // keeping the field labels intact (#1815, live OCH3 detail page).
  const paragraphs = $("div.paragraph");
  const lines: string[] = [];
  paragraphs.each((_i, el) => {
    const block = stripHtmlTags($(el).html() ?? "", "\n");
    if (block) lines.push(block);
    lines.push(""); // blank line between paragraphs
  });
  const fullText = lines.join("\n");

  if (!fullText.trim()) return null;

  // Run number: "Run 1989"
  const runMatch = /Run\s+(\d+)/i.exec(fullText);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Date: use parseOCH3Date with current year as fallback
  const currentYear = new Date().getFullYear();
  const date = parseOCH3Date(fullText, currentYear);

  // Time: dot notation "19.30" or "11.00"
  const startTime = parseDotTime(fullText);

  // Venue: text after "Venue:" label
  let location: string | undefined;
  const venueMatch = /Venue\s*[:\-–—]\s*(.+?)(?:\n|$)/i.exec(fullText);
  if (venueMatch) {
    location = venueMatch[1].trim();
    if (isPlaceholder(location)) location = undefined;
  }

  // Hares: text after "Hare:" or "Hare -" (handles split-tag "Hare:")
  let hares: string | undefined;
  const hareMatch = /[Hh]ares?\s*[:\-–—]\s*(.+?)(?:\n|$)/i.exec(fullText);
  if (hareMatch) {
    const haresText = splitHareFromOnInn(hareMatch[1].trim());
    if (haresText && !isPlaceholder(haresText)) {
      hares = haresText;
    }
  }

  // On Inn: text after "On Inn"
  let onInn: string | undefined;
  const onInnMatch = /On\s+Inn\s*[:\-–—]\s*(.+?)(?:\n|$)/i.exec(fullText);
  if (onInnMatch) {
    const onInnText = onInnMatch[1].trim();
    if (!isPlaceholder(onInnText)) {
      onInn = onInnText;
    }
  }

  // Coordinates from .wsite-map iframe src: "long=-0.3321353&lat=51.2336578"
  let latitude: number | undefined;
  let longitude: number | undefined;
  const iframeSrc = $(".wsite-map iframe").attr("src") || "";
  const latMatch = /lat=(-?[\d.]+)/.exec(iframeSrc);
  const longMatch = /long=(-?[\d.]+)/.exec(iframeSrc);
  if (latMatch && longMatch) {
    latitude = parseFloat(latMatch[1]);
    longitude = parseFloat(longMatch[1]);
    if (isNaN(latitude) || isNaN(longitude)) {
      latitude = undefined;
      longitude = undefined;
    }
  }

  return {
    date,
    runNumber,
    startTime,
    location,
    hares,
    latitude,
    longitude,
    onInn,
    sourceUrl: detailUrl,
  };
}

/**
 * Merge detail-page data into a run-list event.
 * Detail fields override run-list fields where present.
 */
export function mergeDetailIntoEvent(event: RawEventData, detail: DetailPageData): RawEventData {
  const merged: RawEventData = { ...event };

  if (detail.runNumber != null) merged.runNumber = detail.runNumber;
  if (detail.startTime) merged.startTime = detail.startTime;
  if (detail.location) merged.location = detail.location;
  if (detail.latitude != null && detail.longitude != null) {
    merged.latitude = detail.latitude;
    merged.longitude = detail.longitude;
  }
  if (detail.hares) {
    merged.hares = detail.hares;
    // Clear title if it's just the hare name (run-list sets hare as title for OCH3)
    if (merged.title && detail.hares.toLowerCase().includes(merged.title.toLowerCase())) {
      merged.title = undefined;
    }
  }
  if (detail.onInn) {
    merged.description = `On Inn: ${detail.onInn}`;
  }
  merged.sourceUrl = detail.sourceUrl;

  return merged;
}


/**
 * Parse the OCH3 events/links page into event data.
 * The page has a `<ul>` with `<li>` items for special/memorial events.
 * Each <li> follows: "DDth Month YYYY - Title - Venue. Description..."
 */
export function parseEventsPage(html: string, baseUrl: string): RawEventData[] {
  const $ = cheerioLoad(html);
  const events: RawEventData[] = [];
  const currentYear = new Date().getFullYear();

  // Only scrape the "OCH3 Events" paragraph — skip "Links to local hashes"
  // and "Events from other Hashes" sections whose <li> items contain day-of-week
  // words (e.g., "Barnes H3 (Wednesday evenings)") that chrono misparses as dates.
  const eventsPara = $("div.paragraph").filter((_i, el) =>
    /^OCH3 Events$/i.test($(el).find("strong").first().text().trim()),
  ).first();
  eventsPara.find("li").each((_i, el) => {
    // Strip zero-width chars Weebly injects (U+200B survives trim() and JS
    // `\s`) so the anchored date-prefix strip below works and the date cell
    // never leaks through as a title (#1814).
    const fullText = stripZeroWidth($(el).text()).trim();
    if (!fullText) return;

    // Extract date from start of text
    const date = parseOCH3Date(fullText, currentYear);
    if (!date) return;

    // Strip the date prefix to get remaining content
    const withoutDate = fullText
      .replace(/^\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?\s*-?\s*/i, "")
      .trim();

    // Split on " - " to extract title and venue
    const segments = withoutDate.split(/\s+-\s+/).map(s => s.trim()).filter(Boolean);
    let title = segments[0]?.replace(/\.\s*$/, "").trim() || undefined;
    // Belt-and-suspenders (#1814): if the only "title" text is itself a date,
    // the row had no discrete title — never synthesize one from the date cell.
    if (title && /^\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+/.test(title) && parseOCH3Date(title, currentYear)) {
      title = undefined;
    }

    // Try to find venue: "From [venue]" > last dash-segment > "at The [venue]" pattern
    let location: string | undefined;
    const fromMatch = fullText.match(/From\s+(.+?)(?:\.|$)/i);
    if (fromMatch) {
      location = fromMatch[1].trim();
    } else if (segments.length > 1) {
      location = segments[segments.length - 1];
    } else {
      // Single segment — try to extract venue from "... at The [Venue]" pattern
      const atVenue = withoutDate.match(/\bat\s+(The\s+\w[^.]*)/i);
      if (atVenue) location = atVenue[1].replace(/\.\s*$/, "").trim();
    }
    // Defensive milestone-prefix strip (#1580): when an entry reads "Nth run
    // [and overnight stay] at <venue>", the description text leaks into
    // location through any of the three branches above. cleanMilestoneLocation
    // removes the leading "<N>th run … at " framing and trailing period.
    location = cleanMilestoneLocation(location);

    // Description: everything after the first sentence or two
    const sentences = fullText.split(/\.\s+/);
    const description = sentences.length > 1 ? sentences.slice(1).join(". ").trim() : undefined;

    events.push({
      date,
      kennelTags: ["och3"],
      title,
      location,
      description: description || undefined,
      startTime: getStartTimeForDay(extractDayOfWeek(fullText) ?? inferDayFromDate(date)),
      sourceUrl: baseUrl,
    });
  });

  return events;
}

/** Normalize raw text for line-based OCH3 parsing. */
function normalizeOCH3Text(text: string): string {
  // Strip zero-width chars FIRST: Weebly injects U+200B which JS `\s` does not
  // match, so a leading zero-width space defeats the anchored
  // SECTION_DATE_PREFIX_RE and leaks the date cell through as a title (#1814).
  return stripZeroWidth(text)
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

interface ParsedSegments {
  title?: string;
  location?: string;
  hares?: string;
}

/**
 * Detect the milestone-run layout where the leading segment is a milestone
 * title (e.g. "2000th Run") and the trailing segment is the hare, instead of
 * the canonical {hare}-{venue} order. Generalized to ≥3 digits so 10000th
 * runs etc. parse correctly (#1273).
 */
const MILESTONE_RUN_RE = /^(\d{3,})(?:st|nd|rd|th)?\s+Run\b/i;

// A hash-name nickname in quotes — "Linda 'One in the Eye' Cooper",
// "Jamie 'Phil the Greek' Wheadon". Matches straight and curly quote pairs.
const QUOTED_NICKNAME_RE = /['‘’][^'‘’]+['‘’]/;
// Event-title keywords. A titled hash event ("Memorial Run for Lawrence
// 'Dynorod' Pearce", "'Chipmonk's last lay' Hash") carries one of these
// OUTSIDE the quoted nickname; a real hare name ("Linda 'One in the Eye'
// Cooper") does not. We strip the nickname before testing so a hash name like
// 'Runs with Scissors' doesn't trip the keyword guard.
const EVENT_KEYWORD_RE = /\b(?:runs?|hash|trail|party|memorial|anniversary|special|joint|invitational|bash)\b/i;
/**
 * A run-list segment is the hare when it carries a quoted hash-name, the quote
 * is not segment-initial (that marks a titled event), and the surrounding text
 * has no event keyword. Position-independent so both the hare-first and
 * venue-first orderings resolve correctly (#1813).
 */
function isHareSegment(s: string): boolean {
  const t = s.trim();
  if (!QUOTED_NICKNAME_RE.test(t)) return false;
  if (/^['‘’]/.test(t)) return false; // quote-initial → titled event, not a hare
  return !EVENT_KEYWORD_RE.test(t.replace(QUOTED_NICKNAME_RE, " "));
}
/** A quoted segment that is NOT a hare is a discrete titled event. */
function isTitledEventSegment(s: string): boolean {
  return QUOTED_NICKNAME_RE.test(s) && !isHareSegment(s);
}

/**
 * Classify dash-delimited segments into title / location / hares.
 *
 * OCH3's upcoming-run-list mixes two orderings depending on the editor:
 *   hare-first   "{date} - {hare} - {venue}"
 *   venue-first  "{date} - {venue} [- {town}] - {hare}"
 * so the hare is detected by its quoted hash-name, position-independent
 * (#1813), and stored in `hares` — the venue never leaks into `title`. Title
 * is left undefined (merge synthesizes "Old Coulsdon H3 Trail #N") unless the
 * row carries a discrete titled-event name.
 *
 * Milestone rows ("{date} - {Nth Run …} - {hare}") keep their existing
 * title-bearing classification.
 */
function classifySegments(segments: string[]): ParsedSegments {
  if (segments.length === 0) return {};
  const first = segments[0];

  if (segments.length >= 2 && MILESTONE_RUN_RE.test(first)) {
    if (segments.length >= 3) {
      return {
        title: first,
        location: segments.slice(1, -1).join(" - "),
        hares: segments.at(-1),
      };
    }
    return { title: first, hares: segments[1] };
  }

  const hareIdx = segments.findIndex(isHareSegment);
  if (hareIdx >= 0) {
    const titleSeg = segments.find(isTitledEventSegment);
    const venue = segments
      .filter((s, i) => i !== hareIdx && s !== titleSeg && !/details to follow/i.test(s))
      .join(", ");
    return {
      title: titleSeg,
      hares: segments[hareIdx],
      location: venue || undefined,
    };
  }

  if (segments.length === 1) return { title: first };

  const last = segments.at(-1);
  return {
    title: first,
    location: last && /details to follow/i.test(last) ? undefined : last,
  };
}

/**
 * Strip description framing from a milestone-run location string (#1580).
 *
 * OCH3 special-event entries are typed as free-form `<li>` text on the
 * `eventslinks.html` page and as dash-delimited segments on the run-list
 * page. When the source labels the venue with milestone framing — e.g.
 * `"2000th run and overnight stay at The Pheasantry"` or
 * `"2000th Run - <prose mentioning venue> - <hare>"` — the framing leaks
 * into the location because the existing extractors keep whichever slice
 * mentions the venue.
 *
 * This post-processor matches a leading milestone marker (`Nth run`) and
 * the FIRST ` at ` token, returning everything after it (the venue + any
 * city/region suffix). If the input has no milestone marker, it's returned
 * unchanged except for trailing-period cleanup. Strings shorter than 3
 * chars after cleaning return undefined.
 */
const MILESTONE_PREFIX_RE = /^\d+(?:st|nd|rd|th)?\s+run\b/i;
// `(\S.*)` instead of `(.+)` anchors the first non-space char deterministically
// so the unbounded greedy quantifier can't backtrack — silences Sonar S5852
// without changing the captured value (the leading char after "at " is always
// non-space in any real venue string we'd want to extract).
const AT_VENUE_TAIL_RE = /\bat\s+(\S.*)$/i;
function cleanMilestoneLocation(loc: string | undefined): string | undefined {
  if (!loc) return undefined;
  let cleaned = loc.trim();
  if (MILESTONE_PREFIX_RE.test(cleaned)) {
    const atMatch = AT_VENUE_TAIL_RE.exec(cleaned);
    if (!atMatch) return undefined;
    cleaned = atMatch[1].trim();
  }
  cleaned = cleaned.replace(/\.\s*$/, "").trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

/** Strip a leading boilerplate/nav fragment off a parsed title, if present. */
function stripNavBleed(title: string | undefined): string | undefined {
  if (!title) return undefined;
  return (
    title
      .replace(/\b(?:home|about us|contact|next run|committee|links|members|gallery)\b.*$/i, "")
      .trim() || undefined
  );
}

/**
 * Strip the leading date off a section so the remainder is the
 * dash-delimited content. Sections enter this function already starting
 * at the date because the boundary scan in parseOCH3EntriesFromText
 * matches at the digit run, never at a day-of-week prefix. The shape is:
 *
 *   "23rd May 2026"        — month name, optional ordinal
 *   "1st June 2026"
 *   "9th March"            — year-less form
 *
 * The trailing " - " separator (if any) is stripped in a second pass so
 * the regex stays trivially bounded (no nested alternation, no compound
 * quantifier overlap — Sonar S5852 friendly).
 */
const SECTION_DATE_PREFIX_RE = /^\d{1,2}[a-z]{0,2}\s+[A-Z][a-z]+(?:\s+\d{4})?/;
const LEADING_DASH_RE = /^\s*-\s*/;

/** Parse a single run entry section into a RawEventData. */
function parseRunEntry(
  section: string,
  inferredYear: number | undefined,
  baseUrl: string,
): { entry: RawEventData | null; year: number | undefined } {
  if (!section || /^upcoming runs:?$/i.test(section)) {
    return { entry: null, year: inferredYear };
  }

  const explicitYearMatch = /\b(20\d{2})\b/.exec(section);
  if (explicitYearMatch) inferredYear = parseInt(explicitYearMatch[1], 10);

  const date = parseOCH3Date(section, inferredYear);
  if (!date) return { entry: null, year: inferredYear };

  if (!inferredYear) {
    inferredYear = parseInt(date.slice(0, 4), 10);
  }

  const withoutDatePrefix = section
    .replace(SECTION_DATE_PREFIX_RE, "")
    .replace(LEADING_DASH_RE, "")
    .trim();
  // Section text is already whitespace-normalized by normalizeOCH3Text
  // (collapses all runs of whitespace to a single space), so a literal
  // " - " split is safe and side-steps Sonar's regex heuristic on
  // \s+-\s+ patterns.
  const segments = withoutDatePrefix
    .split(" - ")
    .map((s) => s.trim())
    .filter(Boolean);

  const { title: rawTitle, location: rawLocation, hares: rawHares } = classifySegments(segments);
  const title = stripNavBleed(rawTitle);
  // Run-list hares now flow into `hares` (not `title`), so apply the same
  // nav/boilerplate strip that previously only guarded the title (#1813).
  const hares = stripNavBleed(rawHares);
  // Defensive milestone-prefix strip (#1580): the 3+ segment branch of
  // classifySegments joins middle segments verbatim, which leaks "<N>th run
  // and overnight stay at …" description text into location when the source
  // formats a milestone entry as "<date> - <milestone label> - <description-
  // that-mentions-venue> - <hares>".
  const location = cleanMilestoneLocation(rawLocation);

  // Run number is exposed only on milestone rows ("2000th Run …"). For every
  // other run-list row emit an explicit null (tri-state clear) so a stale
  // number from a prior scrape is cleared rather than silently inherited from
  // a sibling row (#1813). The detail-page merge still stamps the next run's
  // real number via mergeDetailIntoEvent.
  const milestoneMatch = rawTitle ? MILESTONE_RUN_RE.exec(rawTitle) : null;
  const runNumber = milestoneMatch ? Number.parseInt(milestoneMatch[1], 10) : null;

  return {
    entry: {
      date,
      kennelTags: ["och3"],
      runNumber,
      title,
      location,
      hares,
      startTime: getStartTimeForDay(extractDayOfWeek(section) ?? inferDayFromDate(date)),
      sourceUrl: baseUrl,
    },
    year: inferredYear,
  };
}

function parseOCH3EntriesFromText(text: string, baseUrl: string): RawEventData[] {
  const normalizedText = normalizeOCH3Text(text);

  // Find "DD MonthName" / "DDth MonthName" / "DDth MonthName YYYY" boundaries.
  // The regex is intentionally simple — bounded character classes, no
  // alternation arms — and the "leading digit run can't begin mid-number"
  // constraint is enforced as a post-filter in JS rather than as a
  // (?<!\d) lookbehind. This keeps the engine's backtracking footprint
  // trivially small.
  //
  // Without the digit-prefix filter, "2000th Run" inside "23rd May 2026 -
  // 2000th Run" matched as "00th Run" (\d{1,2}="00", th, " Run"), creating
  // a spurious section boundary that left title="20" and dropped hares
  // (#1273).
  //
  // Day-of-week prefix is intentionally absent: when a row begins
  // "Sunday 23rd May 2026", we slice from "23rd" and the upstream day
  // name stays in the text. parseRunEntry's startTime fallback
  // (extractDayOfWeek ?? inferDayFromDate) covers it.
  const candidateRe = /\d{1,2}[a-z]{0,2}\s+[A-Z][a-z]+(?:\s+\d{4})?/g;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = candidateRe.exec(normalizedText)) !== null) {
    const prevChar = m.index > 0 ? normalizedText[m.index - 1] : "";
    if (prevChar >= "0" && prevChar <= "9") continue;
    matches.push(m);
  }

  const entries: RawEventData[] = [];
  let inferredYear: number | undefined;

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index ?? -1;
    if (start < 0) continue;

    const end = i + 1 < matches.length
      ? matches[i + 1].index ?? normalizedText.length
      : normalizedText.length;

    const section = normalizedText.slice(start, end).trim();
    const { entry, year } = parseRunEntry(section, inferredYear, baseUrl);
    inferredYear = year;
    if (entry) entries.push(entry);
  }

  return entries;
}

/**
 * Old Coulsdon Hash House Harriers (OCH3) HTML Scraper
 *
 * Scrapes och3.org.uk in two parallel fetches:
 * 1. /upcoming-run-list.html — multiple events (date, hare, venue)
 * 2. /next-run-details.html — rich data for the next run (run number, time, full address, coords)
 *
 * The next upcoming event gets enriched with detail-page data when available.
 * OCH3 alternates: Sunday 11 AM / Monday 7:30 PM weekly.
 */
export class OCH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const runListUrl = source.url || "http://www.och3.org.uk/upcoming-run-list.html";

    // Derive detail and events URLs from the same domain
    const urlObj = new URL(runListUrl);
    const detailUrl = `${urlObj.protocol}//${urlObj.host}/next-run-details.html`;
    const eventsUrl = `${urlObj.protocol}//${urlObj.host}/eventslinks.html`;

    // Fetch all three pages in parallel
    const [runListResult, detailResult, eventsResult] = await Promise.all([
      fetchHTMLPage(runListUrl),
      fetchHTMLPage(detailUrl),
      fetchHTMLPage(eventsUrl),
    ]);

    // Run list failure → immediate error return
    if (!runListResult.ok) {
      return runListResult.result;
    }

    // Parse run list using line-based strategy
    // Remove script/style/noscript elements first — Cheerio .text() includes their
    // text content, which caused raw JS (Google Analytics, etc.) to bleed into event data
    const $main = runListResult.$("main, .main-content, #content, .wsite-section-wrap, body").first();
    $main.find("script, style, noscript, nav, header, footer, aside, .nav, .navbar, .header, .footer, .menu, .navigation, .sidebar, [role='navigation']").remove();
    const mainContent = $main.text();
    const events = parseOCH3EntriesFromText(mainContent, runListUrl);

    // Attempt detail page enrichment
    let detailPageMerged = false;
    const warnings: string[] = [];

    if (!detailResult.ok) {
      warnings.push("Detail page fetch failed; using run-list data only");
    } else {
      const detail = parseDetailPage(detailResult.$, detailUrl);
      if (detail?.date) {
        const matchIdx = events.findIndex((e) => e.date === detail.date);
        if (matchIdx >= 0) {
          events[matchIdx] = mergeDetailIntoEvent(events[matchIdx], detail);
          detailPageMerged = true;
        } else {
          // Detail page run not in run list — create new event
          const dayOfWeek = inferDayFromDate(detail.date!);
          events.unshift({
            date: detail.date!,
            kennelTags: ["och3"],
            startTime: detail.startTime ?? getStartTimeForDay(dayOfWeek),
            location: detail.location,
            hares: detail.hares,
            runNumber: detail.runNumber,
            description: detail.onInn ? `On Inn: ${detail.onInn}` : undefined,
            sourceUrl: detail.sourceUrl,
          });
          detailPageMerged = true;
        }
      }
    }

    // Attempt events page enrichment (special/memorial events)
    let eventsPageMerged = 0;
    if (!eventsResult.ok) {
      warnings.push("Events page fetch failed; using run-list data only");
    } else {
      const eventsPageData = parseEventsPage(eventsResult.html, eventsUrl);
      // Build date→index map for O(1) lookup during merge
      const dateToIdx = new Map(events.map((e, i) => [e.date, i]));
      for (const ep of eventsPageData) {
        const idx = dateToIdx.get(ep.date);
        if (idx !== undefined) {
          // Enrich existing event with title/description/location from events page
          if (ep.title && !events[idx].title) events[idx].title = ep.title;
          if (ep.description && !events[idx].description) events[idx].description = ep.description;
          if (ep.location && !events[idx].location) events[idx].location = ep.location;
          eventsPageMerged++;
        } else {
          // New special event not in run list
          dateToIdx.set(ep.date, events.length);
          events.push(ep);
          eventsPageMerged++;
        }
      }
    }

    return {
      events,
      errors: warnings,
      structureHash: runListResult.structureHash,
      diagnosticContext: {
        entriesFound: events.length,
        eventsParsed: events.length,
        fetchDurationMs: runListResult.fetchDurationMs,
        detailPageMerged,
        eventsPageMerged,
      },
    };
  }
}
