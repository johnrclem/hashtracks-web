import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { chronoParseDate, parse12HourTime, googleMapsSearchUrl, fetchHTMLPage } from "../utils";

const mapsUrl = googleMapsSearchUrl;

/**
 * Known placeholder values the site publishes for the "Date" field when the
 * next trail hasn't been scheduled yet (e.g. between events, or hare TBD).
 * These are NOT parse failures — the source is working correctly and simply
 * has nothing to report yet. (#2661)
 */
const DATE_PLACEHOLDER_RE = /^(tbd|tba|n\/?a|coming soon|\?+|-+)$/i;

/**
 * Parse a Philly H3 date string using chrono-node.
 * Handles: "Sat, Feb 14, 2026", "Sat, February 14, 2026"
 */
export function parsePhillyDate(text: string): string | null {
  return chronoParseDate(text, "en-US");
}

/**
 * Parse time from Philly format: "3:00 PM Hash Standard Time" → "15:00"
 */
const parseTime = parse12HourTime;

/**
 * Philly H3 Website Scraper
 *
 * Scrapes hashphilly.com/nexthash/ for the next trail details.
 * The site shows only one event at a time with label:value text fields:
 * Trail Number, Date, Time, Location, Hash Cash.
 */
export class HashPhillyAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://hashphilly.com/nexthash/";

    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;
    const { $, structureHash } = page;

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const bodyText = $("body").text();

    // Extract fields using label:value pattern
    const trailNumberMatch = bodyText.match(/Trail\s*Number:\s*(\d+)/i);
    const dateMatch = bodyText.match(/Date:\s*(.+?)(?:\n|$)/i);
    const timeMatch = bodyText.match(/Time:\s*(.+?)(?:\n|$)/i);
    const locationMatch = bodyText.match(/Location:\s*(.+?)(?:\n|$)/i);

    if (!dateMatch) {
      errorDetails.parse = [{ row: 0, section: "main", field: "date", error: "No date found on page", rawText: bodyText.slice(0, 2000), partialData: { kennelTags: ["philly-h3" ]} }];
      return { events: [], errors: ["No date found on page"], structureHash, errorDetails };
    }

    const rawDate = dateMatch[1].trim();

    // The site publishes "Date: TBD" between hares stepping up — this is the
    // expected steady state, not a scraper bug. Succeed with zero events so
    // consecutive-failure alerts don't fire while the page is legitimately
    // waiting on a hare. (#2661)
    if (DATE_PLACEHOLDER_RE.test(rawDate)) {
      return {
        events: [],
        errors: [],
        structureHash,
        diagnosticContext: { fieldsFound: ["trailNumber"], nextTrailPending: true },
      };
    }

    const dateStr = parsePhillyDate(rawDate);
    if (!dateStr) {
      const message = `Could not parse date: "${rawDate}"`;
      errorDetails.parse = [{ row: 0, section: "main", field: "date", error: message, rawText: bodyText.slice(0, 2000), partialData: { kennelTags: ["philly-h3" ]} }];
      return { events: [], errors: [message], structureHash, errorDetails };
    }

    const runNumber = trailNumberMatch
      ? parseInt(trailNumberMatch[1], 10)
      : undefined;
    const startTime = timeMatch ? parseTime(timeMatch[1].trim()) : undefined;
    const location = locationMatch ? locationMatch[1].trim() : undefined;

    const fieldsFound: string[] = [];
    if (trailNumberMatch) fieldsFound.push("trailNumber");
    if (dateMatch) fieldsFound.push("date");
    if (timeMatch) fieldsFound.push("time");
    if (locationMatch) fieldsFound.push("location");

    events.push({
      date: dateStr,
      kennelTags: ["philly-h3"],
      runNumber,
      // The nexthash page has no event-specific theme (heading is just the
      // kennel name), so synthesize the canonical "Philly H3 Trail #N" title to
      // match the Google Calendar sibling source (#2098). Leave undefined when
      // the run number is absent → merge.ts synthesizes the default; never emit
      // the bare heading or hare name as the title.
      title: runNumber ? `Philly H3 Trail #${runNumber}` : undefined,
      location,
      locationUrl: location ? mapsUrl(location) : undefined,
      startTime,
      sourceUrl: baseUrl,
    });

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: { fieldsFound },
    };
  }
}
