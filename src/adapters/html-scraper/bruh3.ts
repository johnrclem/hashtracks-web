/**
 * Brussels Hash House Harriers (BruH3) Website Adapter
 *
 * Scrapes bruh3.eu for hash events from two pages:
 *   1. /blog/  — upcoming events (next 2-5 runs + Future Dates section)
 *   2. /blog-2/ — write-ups (historical recaps with run data)
 *
 * Both pages share the same format: blocks of text separated by underscore
 * dividers (10+ underscores). Each block contains a Hash number, date,
 * hare(s), and start/après location.
 *
 * The "Future Dates" section on the upcoming page lists dates with hares
 * but no location (e.g., "April 11 - Ed").
 *
 * Deduplication: events from the upcoming page take priority over write-ups
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
import { fetchHTMLPage, buildDateWindow } from "../utils";

// ── Constants ──

const KENNEL_TAG = "bruh3";
const DEFAULT_START_TIME = "15:00";

// ── Regex patterns ──

/** Match run number: "Hash 2339" or "Hash 2339:" */
const HASH_NUMBER_RE = /Hash\s+(\d{3,4})/i;

/** Match European date: DD.MM.YY */
const DATE_RE = /(\d{2})\.(\d{2})\.(\d{2})/;

/** Match hare line */
const HARE_RE = /^Hare:\s*(.+)/im;

/** Match start/après location (both è and e variants) */
const LOCATION_RE = /^Start\s+(?:&|and)\s+apr[èe]s:\s*(.+)/im;

/** Event block separator: 10+ underscores */
const BLOCK_SEPARATOR_RE = /_{10,}/;

/** Future Dates header */
const FUTURE_DATES_RE = /Future\s+Dates:/i;

/** Future date line: "April 11 - Ed" or "May 02 - reserved" */
const FUTURE_DATE_LINE_RE = /^([A-Z][a-z]+\s+\d{1,2})\s*[-–—]\s*(.+)$/;

// ── Exported helpers (for unit testing) ──

/**
 * Parse a 2-digit year to 4-digit year.
 * Assumes years 00-49 are 2000-2049, 50-99 are 1950-1999.
 */
export function expandYear(yy: number): number {
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

/**
 * Parse a European date string (DD.MM.YY) into "YYYY-MM-DD" format.
 * Returns null if no match.
 */
export function parseEuropeanDate(text: string): string | null {
  const match = DATE_RE.exec(text);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const year = expandYear(parseInt(match[3], 10));

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a single event block (text between underscore dividers) into RawEventData.
 * Returns null if the block doesn't contain a valid Hash number + date.
 */
export function parseEventBlock(
  text: string,
  sourceUrl: string,
): RawEventData | null {
  // Extract run number
  const hashMatch = HASH_NUMBER_RE.exec(text);
  if (!hashMatch) return null;
  const runNumber = parseInt(hashMatch[1], 10);

  // Extract date (DD.MM.YY)
  const date = parseEuropeanDate(text);
  if (!date) return null;

  // Extract hare(s)
  const hareMatch = HARE_RE.exec(text);
  const hares = hareMatch ? hareMatch[1].trim() : undefined;

  // Extract location
  const locMatch = LOCATION_RE.exec(text);
  const location = locMatch ? locMatch[1].trim() : undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    title: `BruH3 #${runNumber}`,
    runNumber,
    hares,
    location,
    startTime: DEFAULT_START_TIME,
    sourceUrl,
  };
}

/**
 * Parse "Future Dates" lines into RawEventData entries.
 * These have a month+day and hare but no run number or location.
 *
 * @param text - The full page text after the "Future Dates:" header
 * @param sourceUrl - Source URL for attribution
 * @param referenceYear - Year context for chrono parsing (from year headers like "2026")
 */
export function parseFutureDates(
  text: string,
  sourceUrl: string,
  referenceYear?: number,
): RawEventData[] {
  const events: RawEventData[] = [];
  const lines = text.split(/\n/);

  let currentYear = referenceYear ?? new Date().getFullYear();

  for (const line of lines) {
    const trimmed = line.trim();

    // Check for year header (e.g., "2026", "2027")
    const yearMatch = /^(20\d{2})$/.exec(trimmed);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[1], 10);
      continue;
    }

    // Match future date lines: "April 11 - Ed"
    const dateLineMatch = FUTURE_DATE_LINE_RE.exec(trimmed);
    if (!dateLineMatch) continue;

    const dateStr = dateLineMatch[1];
    const hare = dateLineMatch[2].trim();

    // Parse month+day with chrono, using the current year context
    const ref = new Date(currentYear, 0, 1);
    const parsed = chrono.en.parse(dateStr, { instant: ref });
    if (parsed.length === 0) continue;

    const result = parsed[0].start;
    const year = result.get("year");
    const month = result.get("month");
    const day = result.get("day");
    if (year == null || month == null || day == null) continue;

    // Use the currentYear from the page context, not chrono's inferred year
    const date = `${currentYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    // Skip "reserved" entries — they have a hare placeholder
    const isReserved = /^reserved$/i.test(hare);

    events.push({
      date,
      kennelTag: KENNEL_TAG,
      title: `BruH3 — ${dateStr}`,
      hares: isReserved ? undefined : hare,
      startTime: DEFAULT_START_TIME,
      sourceUrl,
    });
  }

  return events;
}

/**
 * Extract all event blocks from page text (both upcoming and write-ups pages).
 * Splits on underscore dividers and parses each block.
 */
export function extractEvents(
  pageText: string,
  sourceUrl: string,
): { events: RawEventData[]; errors: ParseError[] } {
  const events: RawEventData[] = [];
  const errors: ParseError[] = [];

  // Split into sections on the Future Dates marker
  const futureDatesIdx = pageText.search(FUTURE_DATES_RE);
  const mainText = futureDatesIdx >= 0 ? pageText.slice(0, futureDatesIdx) : pageText;
  const futureDatesText = futureDatesIdx >= 0 ? pageText.slice(futureDatesIdx) : null;

  // Parse structured event blocks from main text
  const blocks = mainText.split(BLOCK_SEPARATOR_RE);

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i].trim();
    if (!block || block.length < 10) continue;

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

  // Parse Future Dates section if present
  if (futureDatesText) {
    try {
      const futureEvents = parseFutureDates(futureDatesText, sourceUrl);
      events.push(...futureEvents);
    } catch (err) {
      errors.push({
        row: -1,
        section: "future_dates",
        error: String(err),
        rawText: futureDatesText.slice(0, 2000),
      });
    }
  }

  return { events, errors };
}

// ── Adapter class ──

export class BruH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const upcomingUrl = source.url || "http://www.bruh3.eu/blog/";
    const config = (source.config ?? {}) as Record<string, unknown>;
    const writeUpsUrl =
      (config.writeUpsUrl as string) ??
      upcomingUrl.replace(/\/blog\//, "/blog-2/");

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

    // Replace <br> with newlines before .text() so line-based regexes work
    upcoming.$(".blog-entry-body br").replaceWith("\n");
    const upcomingText = upcoming.$(".blog-entry-body").text();
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

    // ── 2. Fetch write-ups page ──
    const writeUps = await fetchHTMLPage(writeUpsUrl);
    if (writeUps.ok) {
      totalFetchMs += writeUps.fetchDurationMs;

      writeUps.$(".blog-entry-body br").replaceWith("\n");
      const writeUpsText = writeUps.$(".blog-entry-body").text();
      const { events: writeUpEvents, errors: writeUpErrors } = extractEvents(
        writeUpsText,
        writeUpsUrl,
      );

      // Deduplicate: upcoming events take priority
      for (const ev of writeUpEvents) {
        if (ev.runNumber && seenRunNumbers.has(ev.runNumber)) continue;
        allEvents.push(ev);
        if (ev.runNumber) seenRunNumbers.add(ev.runNumber);
      }
      if (writeUpErrors.length > 0) {
        (errorDetails.parse ??= []).push(
          ...writeUpErrors.map((e) => ({ ...e, section: "write_ups" })),
        );
      }
    } else {
      // Non-fatal: write-ups page failure shouldn't block upcoming events
      allErrors.push(`Write-ups page fetch failed: ${writeUps.result.errors[0]}`);
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
        writeUpEvents: allEvents.length - upcomingEvents.length,
        totalBeforeFilter: allEvents.length,
        totalAfterFilter: filtered.length,
        fetchDurationMs: totalFetchMs,
      },
    };
  }
}
