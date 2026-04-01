/**
 * Calgary H3 Upcoming Runs Scraper (Events Manager HTML)
 *
 * Scrapes https://home.onon.org/upcumming-runs which uses the WordPress
 * Events Manager plugin. Event items have CSS classes:
 *   .em-event.em-item — event container
 *   .em-item-title a — event title + link
 *   .em-event-date — date string (e.g., "April 2, 2026")
 *   .em-event-time — time range (e.g., "7:00 pm - 10:00 pm")
 *   .em-event-location — venue name
 *
 * Note: Events Manager loads events via AJAX, so this adapter uses
 * fetchBrowserRenderedPage() to get the fully rendered HTML.
 *
 * kennelTag: "ch3-ab"
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import {
  fetchBrowserRenderedPage,
  chronoParseDate,
  parse12HourTime,
  stripPlaceholder,
  buildDateWindow,
} from "../utils";

const DEFAULT_START_TIME = "19:00";
const KENNEL_TAG = "ch3-ab";

/**
 * Extract run number from a title like "#2455 - 5'r Run" or "Bad Thursday Hash".
 * Returns the number or undefined if no leading # pattern.
 */
export function parseCalgaryRunNumber(title: string): number | undefined {
  const match = /^#(\d+)/.exec(title.trim());
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/**
 * Extract clean title from a Calgary event title.
 * Strips the "#NNNN - " prefix if present.
 */
export function parseCalgaryTitle(title: string): string {
  return title.replace(/^#\d+\s*[-–—]\s*/, "").trim();
}

/**
 * Extract start time from a time range string like "7:00 pm - 10:00 pm".
 * Takes the first time only.
 */
export function parseCalgaryTime(timeText: string): string {
  return parse12HourTime(timeText) ?? DEFAULT_START_TIME;
}

/**
 * Calgary H3 Upcoming Runs Adapter (Events Manager HTML)
 *
 * Fetches the upcoming runs page via browser rendering (Events Manager
 * loads content via AJAX) and extracts events from the rendered HTML.
 */
export class CalgaryH3HomeAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || "https://home.onon.org/upcumming-runs";

    const page = await fetchBrowserRenderedPage(url, {
      waitFor: ".em-event.em-item",
      timeout: 15000,
    });
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;

    const days = _options?.days ?? source.scrapeDays ?? 90;
    const { minDate, maxDate } = buildDateWindow(days);

    const events: RawEventData[] = [];
    const errors: string[] = [];

    const eventItems = $(".em-event.em-item");

    eventItems.each((_i, el) => {
      try {
        const $el = $(el);

        // Title and source URL
        const titleLink = $el.find(".em-item-title a");
        const rawTitle = titleLink.text().trim();
        const sourceUrl = titleLink.attr("href") || undefined;

        if (!rawTitle) return;

        // Run number and clean title
        const runNumber = parseCalgaryRunNumber(rawTitle);
        const title = parseCalgaryTitle(rawTitle);

        // Date
        const dateText = $el.find(".em-event-date").text().trim();
        const dateStr = chronoParseDate(dateText, "en-US");
        if (!dateStr) {
          errors.push(`Could not parse date: "${dateText}" for "${rawTitle}"`);
          return;
        }

        // Date window filter
        const eventDate = new Date(dateStr + "T12:00:00Z");
        if (eventDate < minDate || eventDate > maxDate) return;

        // Time
        const timeText = $el.find(".em-event-time").text().trim();
        const startTime = timeText ? parseCalgaryTime(timeText) : DEFAULT_START_TIME;

        // Location
        const location = stripPlaceholder($el.find(".em-event-location").text().trim());

        events.push({
          date: dateStr,
          kennelTag: KENNEL_TAG,
          runNumber,
          title: title || undefined,
          location,
          startTime,
          sourceUrl,
        });
      } catch (err) {
        errors.push(`Parse error: ${err}`);
      }
    });

    return {
      events,
      errors,
      structureHash,
      diagnosticContext: {
        fetchMethod: "browser-render",
        eventItemsFound: eventItems.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
