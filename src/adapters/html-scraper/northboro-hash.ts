import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { chronoParseDate, parse12HourTime } from "../utils";
import { fetchBrowserRenderedPage } from "../utils";

/**
 * Parse a time mention from text like "12pm", "12:30pm", "11-12ish", "start time 11-12ish".
 * Returns HH:MM or undefined.
 */
export function parseTimeMention(text: string): string | undefined {
  // Try standard "12:30pm" format first
  const standard = parse12HourTime(text);
  if (standard) return standard;

  // Match bare hour with am/pm: "12pm", "11am"
  const bareMatch = /(\d{1,2})\s*(am|pm)/i.exec(text);
  if (bareMatch) {
    let hours = parseInt(bareMatch[1], 10);
    const ampm = bareMatch[2].toLowerCase();
    if (ampm === "pm" && hours !== 12) hours += 12;
    if (ampm === "am" && hours === 12) hours = 0;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  // Match range like "11-12ish" — take the later time as start
  const rangeMatch = /(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:ish)?/i.exec(text);
  if (rangeMatch) {
    const later = parseInt(rangeMatch[2], 10);
    // Assume PM for reasonable hash start times (10-18)
    const hours = later < 7 ? later + 12 : later;
    return `${hours.toString().padStart(2, "0")}:00`;
  }

  return undefined;
}

/**
 * Parse a single trail text block into RawEventData.
 *
 * Expected patterns:
 * - "February Trail #237, 2/15/26"
 * - "January Trail #236, 1/1/26, Hangover Trail, Scrumples"
 * - "March Trail #238, 3/14/26, Pi Day Hash"
 * Hares on separate line: "Hares: Name1, Name2"
 * Location/time on separate lines: "Worcester, start time 11-12ish"
 */
export function parseTrailBlock(
  lines: string[],
  sourceUrl: string,
): RawEventData | null {
  if (lines.length === 0) return null;

  const firstLine = lines[0].trim();
  if (!firstLine) return null;

  // Match: "<Month> Trail #<num>, <date>" or "<Month> Trail #<num>: <date>"
  const trailMatch =
    /^(\w+)\s+Trail\s*#\s*(\d+)[,:]?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i.exec(
      firstLine,
    );
  if (!trailMatch) return null;

  const runNumber = parseInt(trailMatch[2], 10);
  const dateStr = trailMatch[3];

  // Parse date — add century if 2-digit year (e.g., "2/15/26" → "2/15/2026")
  let normalizedDate = dateStr;
  const shortYear = /^(\d{1,2}\/\d{1,2})\/(\d{2})$/.exec(dateStr);
  if (shortYear) {
    normalizedDate = `${shortYear[1]}/20${shortYear[2]}`;
  }

  const date = chronoParseDate(normalizedDate, "en-US");
  if (!date) return null;

  // Extract title — text after the date on the first line
  const afterDate = firstLine
    .slice(trailMatch.index + trailMatch[0].length)
    .replace(/^[,\s]+/, "")
    .trim();

  // Split remaining first line by commas — first part is title, rest might be hares
  const parts = afterDate ? afterDate.split(",").map((s) => s.trim()) : [];
  const title = parts[0] || undefined;

  // Look for hares in remaining parts of first line or subsequent lines
  let hares: string | undefined;
  if (parts.length > 1) {
    // Last comma-separated value on first line might be hares
    hares = parts.slice(1).join(", ");
  }

  let startTime: string | undefined;
  let location: string | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check for "Hares: Name1, Name2"
    const haresMatch = /^Hares?:\s*(.+)/i.exec(line);
    if (haresMatch) {
      hares = haresMatch[1].trim();
      continue;
    }

    // Check for time mentions
    const time = parseTimeMention(line);
    if (time) {
      startTime = time;
      // Extract location from same line (before "start time" or comma-separated)
      const locMatch = /^([^,]+?)(?:,\s*start\s+time|,\s*\d)/i.exec(line);
      if (locMatch && !/start\s+time/i.test(locMatch[1])) {
        location = locMatch[1].trim();
      }
      continue;
    }

    // If line doesn't match other patterns, treat as location
    if (!location && !/trail|hash|#\d/i.test(line)) {
      location = line;
    }
  }

  return {
    date,
    kennelTag: "NbH3",
    runNumber,
    title: title || `NbH3 Trail #${runNumber}`,
    hares,
    location,
    startTime,
    sourceUrl,
  };
}

/**
 * Northboro Hash House Harriers (NbH3) Wix Site Scraper
 *
 * Scrapes northboroh3.com/calendar via the NAS headless browser rendering service.
 * The site is built on Wix, which renders content via JavaScript — standard HTTP
 * fetch returns empty containers. browserRender() renders the page with Chromium
 * and returns the fully rendered HTML for Cheerio parsing.
 *
 * The /calendar page has two sections:
 * - "Upcumming Trails" — upcoming events (1-2 at a time)
 * - "ANCIENT HASHTORY" — past trails grouped by year
 */
export class NorthboroHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const calendarUrl = (source.url || "https://www.northboroh3.com") + "/calendar";

    const page = await fetchBrowserRenderedPage(calendarUrl, {
      waitFor: "body",
      timeout: 20000,
    });

    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Extract text content from Wix rich-text elements
    // Wix wraps content in divs with data-testid or specific comp-* IDs
    const textBlocks: string[] = [];

    // Get all text from the page body, split by structural breaks
    $("p, h1, h2, h3, h4, h5, h6, li, div[data-testid], span").each(
      (_i, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 3) {
          textBlocks.push(text);
        }
      },
    );

    // Join all text and split into logical blocks by trail pattern
    const allText = textBlocks.join("\n");
    const lines = allText.split("\n").map((l) => l.trim()).filter(Boolean);

    // Find trail entries by matching the trail pattern
    let currentBlock: string[] = [];
    let rowIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isTrailLine =
        /^\w+\s+Trail\s*#\s*\d+[,:]?\s*\d{1,2}\/\d{1,2}/i.test(line);

      if (isTrailLine) {
        // Process previous block if any
        if (currentBlock.length > 0) {
          try {
            const event = parseTrailBlock(currentBlock, calendarUrl);
            if (event) {
              events.push(event);
            }
          } catch (err) {
            errors.push(`Error parsing trail block at row ${rowIndex}: ${err}`);
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              {
                row: rowIndex,
                error: String(err),
                rawText: currentBlock.join("\n").slice(0, 2000),
              },
            ];
          }
          rowIndex++;
        }
        currentBlock = [line];
      } else if (currentBlock.length > 0) {
        // Add continuation lines to current block (hares, location, etc.)
        // Stop if we hit a section header or year heading
        if (/^(ANCIENT HASHTORY|Upcumming|20\d{2}\s*$)/i.test(line)) {
          // Process current block before section break
          try {
            const event = parseTrailBlock(currentBlock, calendarUrl);
            if (event) {
              events.push(event);
            }
          } catch (err) {
            errors.push(`Error parsing trail block at row ${rowIndex}: ${err}`);
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              {
                row: rowIndex,
                error: String(err),
                rawText: currentBlock.join("\n").slice(0, 2000),
              },
            ];
          }
          rowIndex++;
          currentBlock = [];
        } else {
          currentBlock.push(line);
        }
      }
    }

    // Process last block
    if (currentBlock.length > 0) {
      try {
        const event = parseTrailBlock(currentBlock, calendarUrl);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing trail block at row ${rowIndex}: ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: rowIndex,
            error: String(err),
            rawText: currentBlock.join("\n").slice(0, 2000),
          },
        ];
      }
    }

    // Deduplicate by run number (Wix nested elements can produce duplicate text)
    const seen = new Set<number>();
    const dedupedEvents: RawEventData[] = [];
    for (const event of events) {
      if (event.runNumber && seen.has(event.runNumber)) continue;
      if (event.runNumber) seen.add(event.runNumber);
      dedupedEvents.push(event);
    }

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events: dedupedEvents,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        textBlocksFound: textBlocks.length,
        eventsParsed: dedupedEvents.length,
        fetchDurationMs,
      },
    };
  }
}
