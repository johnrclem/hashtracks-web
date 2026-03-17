/**
 * Renegade Hash House Harriers (Columbus, OH) HTML Scraper
 *
 * Scrapes renegadeh3.com/events for upcoming runs.
 * The site is built on Webador and serves static HTML.
 *
 * Event entries follow this pattern in <p> tags:
 *   "#NNN - MM/DD/YY - Event Title"
 * Detail text follows in the next <p> with lines like:
 *   "Hares: ...", "Where: ...", "Hash Cash: ...", etc.
 */

import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { fetchHTMLPage, googleMapsSearchUrl, stripPlaceholder } from "../utils";

const SOURCE_URL = "https://www.renegadeh3.com/events";

/**
 * Parse a "#NNN - MM/DD/YY - Title" header line into components.
 * Returns null if the line doesn't match the expected pattern.
 */
export function parseEventHeader(
  text: string,
): { runNumber: number; date: string; title: string } | null {
  // Match: #293 - 03/21/26 - Event Title
  const match = text.match(
    /^#(\d+)\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(.+)$/,
  );
  if (!match) return null;

  const runNumber = parseInt(match[1], 10);
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  let year = match[4];
  // Handle 2-digit year: 26 → 2026
  if (year.length === 2) {
    const num = parseInt(year, 10);
    year = (num >= 70 ? "19" : "20") + year;
  }

  const date = `${year}-${month}-${day}`;
  const title = match[5].trim();

  return { runNumber, date, title };
}

/**
 * Parse detail lines from an event's description paragraph.
 * Extracts hares, location, start time, hash cash, and other details.
 */
export function parseEventDetails(text: string): {
  hares?: string;
  location?: string;
  locationUrl?: string;
  startTime?: string;
  description?: string;
} {
  const lines = text
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let hares: string | undefined;
  let location: string | undefined;
  let locationUrl: string | undefined;
  let startTime: string | undefined;
  const descParts: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();

    if (lower.startsWith("hares:") || lower.startsWith("hare:")) {
      hares = stripPlaceholder(line.replace(/^hares?:\s*/i, "").trim()) || undefined;
    } else if (lower.startsWith("where:")) {
      const raw = line.replace(/^where:\s*/i, "").trim();
      location = stripPlaceholder(raw) || undefined;
      if (location) {
        locationUrl = googleMapsSearchUrl(location);
      }
    } else if (lower.startsWith("pack away:")) {
      const timeText = line.replace(/^pack away:\s*/i, "").trim();
      startTime = parseTimeToHHMM(timeText);
    } else if (lower.startsWith("chalk talk:") && !startTime) {
      // Use chalk talk as fallback if no "Pack Away" time
      const timeText = line.replace(/^chalk talk:\s*/i, "").trim();
      startTime = parseTimeToHHMM(timeText);
    } else {
      // Accumulate remaining lines as description
      descParts.push(line);
    }
  }

  return {
    hares,
    location,
    locationUrl,
    startTime,
    description: descParts.length > 0 ? descParts.join("\n") : undefined,
  };
}

/** Parse a time like "2:00" or "1:45 PM" into "HH:MM" 24-hour format. */
function parseTimeToHHMM(text: string): string | undefined {
  // "2:00 PM" or "14:00"
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!match) return undefined;

  let hour = parseInt(match[1], 10);
  const min = match[2];
  const ampm = match[3]?.toLowerCase();

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  // If no AM/PM and hour < 7, assume PM (hash times are afternoons/evenings)
  if (!ampm && hour >= 1 && hour < 7) hour += 12;

  return `${hour.toString().padStart(2, "0")}:${min}`;
}

export class RenegadeH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const sourceUrl = source.url || SOURCE_URL;

    const page = await fetchHTMLPage(sourceUrl);
    if (!page.ok) return page.result;
    const { $, structureHash, fetchDurationMs } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Events are in <p> tags inside the main content
    // Header format: "#NNN - MM/DD/YY - Title"
    const paragraphs = $("p");
    let headerCount = 0;

    paragraphs.each((i, el) => {
      const $p = $(el);
      const text = $p.text().trim();

      // Try to parse as event header
      const header = parseEventHeader(text);
      if (!header) return;
      headerCount++;

      try {
        // Look at the next <p> for details
        const $next = $p.next("p");
        const detailText = $next.length > 0 ? $next.text().trim() : "";

        // Only parse details if it looks like event info (not another header)
        const hasDetails = detailText && !parseEventHeader(detailText);
        const details = hasDetails ? parseEventDetails(detailText) : {};

        const event: RawEventData = {
          date: header.date,
          kennelTag: "RH3",
          runNumber: header.runNumber,
          title: header.title,
          hares: details.hares,
          location: details.location,
          locationUrl: details.locationUrl,
          startTime: details.startTime,
          description: details.description,
          sourceUrl,
        };

        events.push(event);
      } catch (err) {
        errors.push(`Error parsing event #${header.runNumber}: ${err}`);
        (errorDetails.parse ??= []).push({
          row: i,
          section: "events",
          error: String(err),
          rawText: text.slice(0, 2000),
        });
      }
    });

    const hasErrors = hasAnyErrors(errorDetails);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        paragraphsFound: paragraphs.length,
        headersFound: headerCount,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
