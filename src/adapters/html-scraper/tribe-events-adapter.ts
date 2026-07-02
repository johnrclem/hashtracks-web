import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { buildDateWindow } from "../utils";
import { fetchTribeEvents } from "../tribe-events";

/**
 * Config-driven adapter for "The Events Calendar" (Tribe) REST sites.
 *
 * The Tribe REST utility (`fetchTribeEvents`) is already used by a bespoke
 * per-kennel adapter (ChooChooH3). This shared adapter generalizes that: any
 * WordPress kennel running the plugin onboards with a config block, no new
 * adapter file. It is dispatched by CONFIG, not URL (see `getAdapter`), so it
 * can coexist with another adapter on the same host — Sydney Larrikins already
 * has a URL-routed weekly HTML scraper on `sydney.larrikins.org`, and its Tribe
 * "special events" feed lives at the same host root. (#2391)
 */
export interface TribeEventsConfig {
  /** Discriminator: routes an HTML_SCRAPER source to this adapter by config. */
  tribeEvents: true;
  /** Kennel shortName/code to assign all events to. */
  kennelTag: string;
  /**
   * Earliest event date to request, "YYYY-MM-DD". Omit for the live source
   * (defaults to today → upcoming only, which pairs with `upcomingOnly` reconcile
   * so past specials freeze instead of being cancelled). Set to a past date only
   * for a one-shot historical backfill.
   */
  startDate?: string;
  /** Fallback "HH:MM" when the API reports an all-day event (no meaningful time). */
  defaultStartTime?: string;
  /** Defensive cap on total events returned. */
  maxEvents?: number;
  /**
   * Read by the reconcile step (scrape.ts), NOT this adapter — documented here
   * so the source's config shape is discoverable in one place. Forward-only
   * special-events feeds set this so a passed one-off isn't cancelled when it
   * drops out of the upcoming window.
   */
  upcomingOnly?: boolean;
}

/** True when a source config opts into the shared Tribe adapter. */
export function isTribeEventsConfig(config: unknown): config is TribeEventsConfig {
  if (!config || typeof config !== "object") return false;
  const c = config as Record<string, unknown>;
  return c.tribeEvents === true && typeof c.kennelTag === "string" && c.kennelTag.length > 0;
}

export class TribeEventsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    if (!isTribeEventsConfig(source.config)) {
      const message = "TribeEventsAdapter: config must set { tribeEvents: true, kennelTag: string }";
      return { events: [], errors: [message], errorDetails: { fetch: [{ message }] } };
    }
    const config = source.config;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Fail closed: with no explicit startDate the API request defaults to today,
    // so the feed is forward-only. Reconcile would then cancel past sole-source
    // events that aged out of the upcoming list unless the source is marked
    // `upcomingOnly` (scrape.ts clamps reconcile to the future for those). Refuse
    // to run rather than silently drive a destructive reconcile — a forward-only
    // source MUST opt in, and a future onboarding of this shared adapter can't
    // forget it. A one-shot backfill sets an explicit startDate and is exempt
    // (it routes through processRawEvents, not the live reconcile path). (#2391)
    if (config.startDate === undefined && config.upcomingOnly !== true) {
      const message =
        "TribeEventsAdapter: a forward-only feed (no startDate) requires config.upcomingOnly:true so reconcile cannot cancel past events";
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: source.url, message }] } };
    }

    const result = await fetchTribeEvents(source.url, {
      perPage: 50,
      maxEvents: config.maxEvents ?? 200,
      startDate: config.startDate,
    });
    if (result.error) {
      errorDetails.fetch = [{ url: source.url, status: result.error.status, message: result.error.message }];
      return { events: [], errors: [result.error.message], errorDetails };
    }

    const { minDate, maxDate } = buildDateWindow(options?.days ?? 180);

    const events: RawEventData[] = [];
    for (const e of result.events) {
      const asDate = new Date(`${e.date}T12:00:00Z`);
      if (asDate < minDate || asDate > maxDate) continue;
      events.push({
        date: e.date,
        // Multi-day span (campout weekend) — undefined for single-day events,
        // which merge.ts treats as "no endDate" (its gated-spread convention).
        endDate: e.endDate,
        // All-day events carry a meaningless 00:00 from the API; drop it (or use
        // the configured fallback) so the card doesn't render "midnight".
        startTime: e.allDay ? config.defaultStartTime : (e.startTime ?? config.defaultStartTime),
        kennelTags: [config.kennelTag],
        title: e.title,
        description: e.description,
        location: e.location || e.venue,
        cost: e.cost,
        sourceUrl: e.url ?? source.url,
      });
    }

    // Surface silent schema drift (e.g. a plugin upgrade renaming fields →
    // everything skipped) as a soft error so health monitoring catches it.
    if (result.skippedCount > 0) {
      errors.push(
        `Skipped ${result.skippedCount}/${result.rawCount} tribe events (missing title or date — possible schema change)`,
      );
    }

    // A truncated fetch (upstream has more events than maxEvents) MUST block
    // reconcile — an empty errors[] would let scrape.ts reconcile against an
    // incomplete set and cancel valid events beyond the cap. scrape.ts gates
    // reconcile on errors.length === 0, so pushing an error is the block. (#2391)
    if (result.capReached) {
      errors.push(
        `Tribe fetch truncated at maxEvents=${config.maxEvents ?? 200} — results incomplete; reconcile skipped to avoid cancelling un-fetched events`,
      );
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        kennelTag: config.kennelTag,
        rawCount: result.rawCount,
        eventsInWindow: events.length,
        skippedCount: result.skippedCount,
        fetchDurationMs: result.fetchDurationMs,
      },
    };
  }
}
