import type * as cheerio from "cheerio";
import { load as cheerioLoad } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
} from "../types";
import { chronoParseDate, fetchHTMLPage, isPlaceholder } from "../utils";

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

/**
 * Parse the OCH3 next-run-details page into structured data.
 * Extracts run number, time, venue, hares, On Inn, and map coordinates.
 */
export function parseDetailPage($: cheerio.CheerioAPI, detailUrl: string): DetailPageData | null {
  // Iterate child nodes within each .paragraph to preserve logical line breaks.
  // The site wraps all content in a single .paragraph div with inline <strong>/<span>/<b>
  // tags — Cheerio .text() on the whole div produces one blob without newlines,
  // causing regexes to capture across field boundaries.
  const paragraphs = $("div.paragraph");
  const lines: string[] = [];
  paragraphs.each((_i, el) => {
    $(el).contents().each((_j, node) => {
      const rawText = $(node).text();
      const text = rawText.trim();
      if (!text) return;
      // Rejoin fragments split across inline tags (e.g., <b>H</b>ares: → "H" + "ares:")
      // If the previous line is a short fragment (≤2 chars), merge with this line.
      // Use rawText (not fully trimmed) to preserve any leading whitespace between nodes,
      // preventing words from running together (e.g., "<strong>I</strong> am" → "I am" not "Iam").
      if (lines.length > 0 && lines[lines.length - 1].length <= 2) {
        lines[lines.length - 1] += rawText.trimEnd();
      } else {
        lines.push(text);
      }
    });
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
    const haresText = hareMatch[1].trim();
    if (!isPlaceholder(haresText)) {
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
    const fullText = $(el).text().trim();
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
    const title = segments[0]?.replace(/\.\s*$/, "").trim() || undefined;

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

    // Description: everything after the first sentence or two
    const sentences = fullText.split(/\.\s+/);
    const description = sentences.length > 1 ? sentences.slice(1).join(". ").trim() : undefined;

    events.push({
      date,
      kennelTag: "OCH3",
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
  return text
    .replace(/\r/g, "")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a single run entry section into a RawEventData. */
function parseRunEntry(
  section: string,
  inferredYear: number | undefined,
  baseUrl: string,
): { entry: RawEventData | null; year: number | undefined } {
  if (!section || /^upcoming runs:?$/i.test(section)) {
    return { entry: null, year: inferredYear };
  }

  const explicitYearMatch = section.match(/\b(20\d{2})\b/);
  if (explicitYearMatch) inferredYear = parseInt(explicitYearMatch[1], 10);

  const date = parseOCH3Date(section, inferredYear);
  if (!date) return { entry: null, year: inferredYear };

  if (!inferredYear) {
    inferredYear = parseInt(date.slice(0, 4), 10);
  }

  const withoutDatePrefix = section
    .replace(/^(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?\s*-?\s*/i, "")
    .trim();

  const segments = withoutDatePrefix.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  let title = segments.length > 0 ? segments[0] : undefined;
  // Strip nav/boilerplate phrases that bleed through from page text
  if (title) {
    title = title
      .replace(/\b(?:home|about us|contact|next run|committee|links|members|gallery)\b.*$/i, "")
      .trim() || undefined;
  }

  let location: string | undefined;
  if (segments.length > 1) {
    location = segments[segments.length - 1];
    if (/details to follow/i.test(location)) location = undefined;
  }

  return {
    entry: {
      date,
      kennelTag: "OCH3",
      title,
      location,
      startTime: getStartTimeForDay(extractDayOfWeek(section) ?? inferDayFromDate(date)),
      sourceUrl: baseUrl,
    },
    year: inferredYear,
  };
}

function parseOCH3EntriesFromText(text: string, baseUrl: string): RawEventData[] {
  const normalizedText = normalizeOCH3Text(text);

  const dateStartPattern = /(?:(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+)?\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?/gi;
  const matches = [...normalizedText.matchAll(dateStartPattern)];

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
            kennelTag: "OCH3",
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
