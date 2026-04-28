import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { buildDateWindow } from "../utils";
import { fetchTribeEvents } from "../tribe-events";

const KENNEL_TAG = "choochooh3";

/**
 * Chattanooga Choo Choo H3 (TN) adapter.
 *
 * Uses the generic Tribe Events REST API utility against choochooh3.com,
 * which runs "The Events Calendar" plugin.
 */
export class ChooChooH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const result = await fetchTribeEvents(baseUrl, { perPage: 50, maxEvents: 200 });
    if (result.error) {
      errorDetails.fetch = [
        {
          url: baseUrl,
          status: result.error.status,
          message: result.error.message,
        },
      ];
      return { events: [], errors: [result.error.message], errorDetails };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    const events: RawEventData[] = [];
    for (const e of result.events) {
      const asDate = new Date(`${e.date}T12:00:00Z`);
      if (asDate < minDate || asDate > maxDate) continue;
      events.push({
        date: e.date,
        // All-day events carry a meaningless 00:00 from the API; omit so the
        // canonical record doesn't show "midnight".
        startTime: e.allDay ? undefined : e.startTime,
        kennelTags: [KENNEL_TAG],
        title: e.title,
        description: e.description,
        location: e.location || e.venue,
        sourceUrl: e.url ?? baseUrl,
      });
    }

    // Surface soft signals so health monitoring can catch silent schema drift
    // (e.g. a plugin upgrade that renames fields → all events skipped).
    if (result.skippedCount > 0) {
      errors.push(
        `Skipped ${result.skippedCount}/${result.rawCount} tribe events (missing title or date — possible schema change)`,
      );
    }

    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        rawEventsFetched: result.rawCount,
        eventsNormalized: result.events.length,
        eventsInWindow: events.length,
        skippedCount: result.skippedCount,
        categoryFilteredCount: result.categoryFilteredCount,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
