import { isText, type Element } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, parse12HourTime, chronoParseDate } from "../utils";

/**
 * Parse a single event block from the Hockessin Hash homepage.
 *
 * The site uses 90s-era HTML with `<font>` and `<b>` tags, no CSS classes.
 * Each event has:
 *   <font color="..."><b>Hash #1656: Green Dress Hash</b></font> <br>
 *   SATURDAY, March 14, 2026, 3:00pm, (Prelube at 2:30PM, pack off 3:15), 404 New London Road, Newark, DE <br>
 *
 * @param headerText - The text from the <b> tag (e.g., "Hash #1656: Green Dress Hash")
 * @param detailText - The raw text node after the header (date, time, location info)
 * @param sourceUrl  - Source URL for fallback
 */
export function parseHockessinEvent(
  headerText: string,
  detailText: string,
  sourceUrl: string,
): RawEventData | null {
  // Extract run number and title from header
  const headerMatch = /Hash\s*#(\d+)\s*:\s*(.+)/i.exec(headerText);
  if (!headerMatch) return null;

  const runNumber = Number.parseInt(headerMatch[1], 10);
  const title = headerMatch[2].trim();

  // Clean up detail text — remove leading/trailing whitespace and BRs
  const cleaned = detailText.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // Parse date using chrono (handles "SATURDAY, March 14, 2026" etc.)
  const date = chronoParseDate(cleaned, "en-US", undefined, { forwardDate: true });
  if (!date) return null;

  // Extract time — find the first HH:MM am/pm pattern
  const startTime = parse12HourTime(cleaned);

  // Extract location — everything after time + parenthetical notes
  // Pattern: strip day name, date, time, and parenthetical notes to get location
  let location: string | undefined;

  // Remove parenthetical notes like "(Prelube at 2:30PM, pack off 3:15)"
  const withoutParens = cleaned.replace(/\([^)]*\)/g, ",");

  // Split on commas, skip the day name, date parts, and time parts
  const parts = withoutParens.split(",").map(p => p.trim()).filter(Boolean);

  // Find the index after all date/time parts — location starts after
  // Date/time parts match: day names, month names, year, time patterns, or
  // "Month Day" compound tokens like "March 14" that land in a single comma-split part.
  const dateTimeRe = /^(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}(?:st|nd|rd|th)?|\d{4}|\d{1,2}:\d{2}\s*(?:am|pm)?)$/i;
  // Also matches "Month Day" compound (e.g. "March 14" or "June 17")
  const monthDayRe = /^(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?$/i;
  const timeLooseRe = /\d{1,2}:\d{2}\s*(?:am|pm)/i;

  let locationStartIndex = -1;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Skip parts that look like date/time components
    if (dateTimeRe.test(part)) continue;
    if (monthDayRe.test(part)) continue;
    if (timeLooseRe.test(part)) continue;
    // First part that doesn't look like date/time is the start of location
    locationStartIndex = i;
    break;
  }

  if (locationStartIndex >= 0) {
    location = parts.slice(locationStartIndex).join(", ").trim();
    // Clean up artifacts from paren removal
    location = location.replace(/^,\s*/, "").replace(/,\s*,/g, ",").replace(/,\s*$/, "").trim();
    if (!location) location = undefined;
  }

  return {
    date,
    kennelTag: "H4",
    runNumber: !Number.isNaN(runNumber) ? runNumber : undefined,
    title: title || `Hockessin #${runNumber}`,
    location,
    startTime,
    sourceUrl,
  };
}

/**
 * Hockessin Hash House Harriers (H4) Website Scraper
 *
 * Scrapes hockessinhash.org — a 90s-era HTML page with events listed using
 * `<font>` and `<b>` tags. Each event block has a "Hash #NNN: Title" header
 * followed by date/time/location text.
 */
export class HockessinAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://www.hockessinhash.org/";

    const page = await fetchHTMLPage(url);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let blockIndex = 0;

    // Find <b> tags that contain "Hash #NNN" pattern
    $("b").each((_i, el) => {
      const $b = $(el);
      const headerText = $b.text().trim();

      if (!/Hash\s*#\d+/i.test(headerText)) return;

      blockIndex++;

      try {
        // Get the text content after this event header
        // Walk up to the parent <font> tag, then get the next text sibling
        const $parent = $b.parent();
        let detailText = "";

        // Get everything after the header's parent element until the next <br> or block
        // The detail text is typically the next text node sibling after the </font> tag
        const parentNode = $parent.length > 0 ? $parent[0] : $b[0];
        let sibling = parentNode.nextSibling;
        while (sibling) {
          if (isText(sibling)) {
            detailText += sibling.data;
          } else if (sibling.type === "tag") {
            const tagName = (sibling as Element).tagName?.toLowerCase();
            if (tagName === "br") {
              // Hit a <br> — check if we already have detail text
              if (detailText.trim()) break;
            } else if (tagName === "font" || tagName === "b") {
              // Hit the next event header — stop
              const innerText = $(sibling).text();
              if (/Hash\s*#\d+/i.test(innerText)) break;
            }
          }
          sibling = sibling.nextSibling;
        }

        const event = parseHockessinEvent(headerText, detailText, url);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing block ${blockIndex}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: blockIndex,
          error: String(err),
          rawText: headerText.slice(0, 2000),
        });
      }
    });

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        blocksFound: blockIndex,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
