/**
 * Amsterdam Hash House Harriers (AH3) Website Adapter
 *
 * Scrapes ah3.nl for hash events from two pages:
 *   1. /nextruns/  — upcoming events
 *   2. /previous/  — historical/past events
 *
 * Both pages use the same WordPress format: an `.entry-content` div with
 * event blocks separated by `___good_to_know` markers. Each block contains:
 *   - An event title (<h1>)
 *   - Run number + hare(s) on a "Run № NNNN by Hare Name" line
 *   - Date/time: "Saturday 04 April, 2026 at 14:45 hrs"
 *   - Location: venue name (bold) followed by address line
 *
 * Blocks without hares that contain "Click if you want to hare this run"
 * are still included (they have a date and run number), but hares will be
 * undefined.
 *
 * Deduplication: upcoming events take priority over previous events
 * when the same run number appears in both.
 */

import * as cheerio from "cheerio";
import * as chrono from "chrono-node";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, buildDateWindow, decodeEntities } from "../utils";

// ── Constants ──

const KENNEL_TAG = "ah3-nl";

// ── Regex patterns ──

/** Match run number and optional hare(s): "Run № 1476 by War 'n Piece & MiaB" */
const RUN_NUMBER_RE = /Run\s*[№#]\s*(\d{4,5})\s*(?:by\s+(.+))?/i;

/** Match date + time: "Saturday 04 April, 2026 at 14:45 hrs" */
const DATE_TIME_RE =
  /(?:Sunday|Saturday|Monday|Tuesday|Wednesday|Thursday|Friday)\s+(\d{1,2}\s+\w+,?\s+\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*hrs/i;

/** Block separator: ___good_to_know */
const BLOCK_SEPARATOR = "___good_to_know";

// ── Exported helpers (for unit testing) ──

/**
 * Parse a single event block (text between ___good_to_know dividers) into RawEventData.
 * Returns null if the block doesn't contain a valid run number + date.
 */
export function parseEventBlock(
  text: string,
  sourceUrl: string,
): RawEventData | null {
  // Extract run number and optional hares
  const runMatch = RUN_NUMBER_RE.exec(text);
  if (!runMatch) return null;
  const runNumber = parseInt(runMatch[1], 10);

  // Extract hares (if present and not just a "Click to hare" button)
  let hares: string | undefined;
  if (runMatch[2]) {
    const hareTrimmed = runMatch[2].trim();
    // Skip CTA-only "hare" text
    if (!/Click if you want to hare/i.test(hareTrimmed)) {
      hares = hareTrimmed;
    }
  }

  // Extract date and time
  const dtMatch = DATE_TIME_RE.exec(text);
  if (!dtMatch) return null;

  const dateStr = dtMatch[1]; // e.g., "04 April, 2026"
  const hours = dtMatch[2];
  const minutes = dtMatch[3];

  // Parse the date portion with chrono
  const parsed = chrono.en.parse(dateStr);
  if (parsed.length === 0) return null;

  const result = parsed[0].start;
  const year = result.get("year");
  const month = result.get("month");
  const day = result.get("day");
  if (year == null || month == null || day == null) return null;

  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const startTime = `${hours.padStart(2, "0")}:${minutes}`;

  // Extract title: look for text before "Run №" — typically the first line
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  let title: string | undefined;
  for (const line of lines) {
    // Skip empty and short lines
    if (line.length < 2) continue;
    // Stop at the run number line
    if (/Run\s*[№#]\s*\d/i.test(line)) break;
    // Use the first substantive line as the title
    if (!title && line.length > 1 && !/^[_\-=]+$/.test(line)) {
      title = line;
    }
  }

  // Extract location: lines after the date line
  let location: string | undefined;
  let locationStreet: string | undefined;

  const dateLineIdx = lines.findIndex((l) => DATE_TIME_RE.test(l));
  if (dateLineIdx >= 0) {
    // The line immediately after the date is the venue name
    const venueLine = lines[dateLineIdx + 1];
    if (venueLine && !/Map\s*$/.test(venueLine) && !/Let us know/.test(venueLine)) {
      location = venueLine
        .replace(/Map\s*$/, "")
        .replace(/\s+$/, "")
        .trim();
      // Skip "somewhere" placeholder
      if (/^somewhere$/i.test(location)) {
        location = undefined;
      }
    }

    // The line after venue might be a street address (contains comma + postal code)
    const addressLine = lines[dateLineIdx + 2];
    if (addressLine && /\d{4}\s*[A-Z]{2}/.test(addressLine)) {
      locationStreet = addressLine
        .replace(/Map\s*$/, "")
        .replace(/\s+$/, "")
        .trim();
    }
  }

  // Build event title
  const eventTitle = title
    ? `AH3 #${runNumber} — ${title}`
    : `AH3 #${runNumber}`;

  return {
    date,
    kennelTag: KENNEL_TAG,
    title: eventTitle,
    runNumber,
    hares,
    location,
    locationStreet,
    startTime,
    sourceUrl,
  };
}

/**
 * Extract all event blocks from page text.
 * Splits on ___good_to_know markers plus <hr> separators, then parses each block.
 */
export function extractEvents(
  pageText: string,
  sourceUrl: string,
): { events: RawEventData[]; errors: ParseError[] } {
  const events: RawEventData[] = [];
  const errors: ParseError[] = [];

  // Split on ___good_to_know markers (which appear within blocks after the event data)
  // and also on horizontal rule separators
  const blocks = pageText.split(/___good_to_know/i);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block || block.length < 20) continue;

    // A single block may contain content from the previous event's ___good_to_know
    // section AND the next event's header. We need to find the run number line.
    if (!RUN_NUMBER_RE.test(block)) continue;

    try {
      const event = parseEventBlock(block, sourceUrl);
      if (event) events.push(event);
    } catch (err) {
      errors.push({
        row: i,
        error: String(err),
        rawText: block.slice(0, 2000),
      });
    }
  }

  return { events, errors };
}

/**
 * Convert raw HTML from AH3's .entry-content into line-separated text.
 * Replaces <br>, <h1>, <hr>, and block-level tags with newlines.
 */
export function htmlToText($: cheerio.CheerioAPI): string {
  const content = $(".entry-content");
  if (content.length === 0) return "";

  // Replace <br> with newlines
  content.find("br").replaceWith("\n");
  // Replace block-level tags with newlines for clean text extraction
  content.find("h1").each(function () {
    $(this).replaceWith("\n" + $(this).text() + "\n");
  });

  return decodeEntities(content.text());
}

// ── Adapter class ──

export class AH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const upcomingUrl = source.url || "https://ah3.nl/nextruns/";
    const config = (source.config ?? {}) as Record<string, unknown>;
    const previousUrl =
      (config.previousUrl as string) ??
      upcomingUrl.replace(/nextruns\/?/, "previous/");

    const allEvents: RawEventData[] = [];
    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const seenRunNumbers = new Set<number>();
    let totalFetchMs = 0;

    // ── 1. Fetch upcoming page ──
    const upcoming = await fetchHTMLPage(upcomingUrl);
    if (!upcoming.ok) return upcoming.result;

    const structureHash = upcoming.structureHash;
    totalFetchMs += upcoming.fetchDurationMs;

    const upcomingText = htmlToText(upcoming.$);
    const { events: upcomingEvents, errors: upcomingErrors } = extractEvents(
      upcomingText,
      upcomingUrl,
    );

    for (const ev of upcomingEvents) {
      allEvents.push(ev);
      if (ev.runNumber) seenRunNumbers.add(ev.runNumber);
    }
    if (upcomingErrors.length > 0) {
      (errorDetails.parse ??= []).push(
        ...upcomingErrors.map((e) => ({ ...e, section: "upcoming" })),
      );
    }

    // ── 2. Fetch previous page ──
    const previous = await fetchHTMLPage(previousUrl);
    if (previous.ok) {
      totalFetchMs += previous.fetchDurationMs;

      const previousText = htmlToText(previous.$);
      const { events: previousEvents, errors: previousErrors } = extractEvents(
        previousText,
        previousUrl,
      );

      // Deduplicate: upcoming events take priority
      for (const ev of previousEvents) {
        if (ev.runNumber && seenRunNumbers.has(ev.runNumber)) continue;
        allEvents.push(ev);
        if (ev.runNumber) seenRunNumbers.add(ev.runNumber);
      }
      if (previousErrors.length > 0) {
        (errorDetails.parse ??= []).push(
          ...previousErrors.map((e) => ({ ...e, section: "previous" })),
        );
      }
    } else {
      // Non-fatal: previous page failure shouldn't block upcoming events
      allErrors.push(`Previous page fetch failed: ${previous.result.errors[0]}`);
    }

    // ── 3. Filter by date window ──
    const { minDate, maxDate } = buildDateWindow(source.scrapeDays ?? 365);
    const filtered = allEvents.filter((ev) => {
      const d = new Date(ev.date + "T12:00:00Z");
      return d >= minDate && d <= maxDate;
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: filtered,
      errors: allErrors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        upcomingEvents: upcomingEvents.length,
        previousEvents: allEvents.length - upcomingEvents.length,
        totalBeforeFilter: allEvents.length,
        totalAfterFilter: filtered.length,
        fetchDurationMs: totalFetchMs,
      },
    };
  }
}
