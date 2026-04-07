import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { buildDateWindow } from "../utils";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { fetchTribeEvents } from "../tribe-events";

const DEFAULT_BASE = "https://choochooh3.com";
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
    const baseUrl = source.url || DEFAULT_BASE;
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
        startTime: e.startTime,
        kennelTag: KENNEL_TAG,
        title: e.title,
        location: e.location || e.venue,
        sourceUrl: e.url ?? baseUrl,
      });
    }

    const structureHash = generateStructureHash(JSON.stringify(result.events.map((e) => e.id)));
    const hasErrors = hasAnyErrors(errorDetails);
    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrors ? errorDetails : undefined,
      diagnosticContext: {
        tribeEventsFetched: result.events.length,
        eventsParsed: events.length,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
