import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { applyDateWindow } from "../utils";
import { fetchTribeEvents } from "../tribe-events";

/**
 * Las Vegas H3 (lvh3.org) adapter — Tribe Events Calendar REST API.
 *
 * lvh3.org hosts events for multiple Las Vegas kennels:
 * - LVHHH (Las Vegas Hash House Harriers, 1st/3rd/5th Sat)
 * - ASSH3 (Atomic Shit Show H3, 2nd/4th Fri)
 * - RPHHH (Rat Pack, annual Jan 1)
 * - BASHHH (specials)
 *
 * Events are categorized via WordPress category slugs. The source config
 * maps category slugs to kennel tags via `kennelPatterns`:
 *   [["lvhhh", "lv-h3"], ["assh3", "ass-h3"]]
 *
 * The iCal feed at lvh3.org is broken (returns empty) — this adapter
 * uses the REST API at /wp-json/tribe/events/v1/events/ instead.
 */

/** Resolve a kennel tag from event categories using source config patterns. */
export function resolveKennelTag(
  categories: string[],
  kennelPatterns: [string, string][],
  defaultTag: string | null,
): string | null {
  const lowerCats = categories.map((c) => c.toLowerCase());
  for (const [slug, tag] of kennelPatterns) {
    if (lowerCats.includes(slug.toLowerCase())) return tag;
  }
  return defaultTag;
}

/** Extract a run number from a title like "#1748 Boys Gone wild" or "Trail# 27" */
export function extractLvRunNumber(title: string): number | undefined {
  const m = /(?:#|Trail\s*#?\s*)\s*(\d+)/i.exec(title);
  return m ? Number.parseInt(m[1], 10) : undefined;
}

export class LVH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://lvh3.org";
    const config = (source.config ?? {}) as Record<string, unknown>;
    const kennelPatterns = (config.kennelPatterns as [string, string][] | undefined) ?? [];

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Pass a startDate far enough back to include historical events
    // within the adapter's date window. The window filter (applyDateWindow)
    // handles the actual bound — this just ensures the API returns enough.
    const days = options?.days ?? source.scrapeDays ?? 365;
    const startMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const startDate = new Date(startMs).toISOString().slice(0, 10);
    const result = await fetchTribeEvents(baseUrl, { perPage: 50, maxEvents: 500, startDate });
    if (result.error) {
      errorDetails.fetch = [
        { url: baseUrl, status: result.error.status, message: result.error.message },
      ];
      return { events: [], errors: [result.error.message], errorDetails };
    }

    const events: RawEventData[] = [];
    let categorySkipped = 0;
    for (const e of result.events) {
      // Skip events whose categories don't match any configured kennel —
      // lvh3.org also hosts RPHHH (Rat Pack) and BASHHH (specials) which
      // are not seeded. Defaulting would misfile them under Las Vegas H3.
      const kennelTag = resolveKennelTag(e.categorySlugs, kennelPatterns, null);
      if (!kennelTag) {
        categorySkipped++;
        continue;
      }

      events.push({
        date: e.date,
        startTime: e.allDay ? undefined : e.startTime,
        kennelTag,
        title: e.title,
        runNumber: extractLvRunNumber(e.title ?? ""),
        description: e.description,
        location: e.location || e.venue,
        sourceUrl: e.url ?? baseUrl,
      });
    }

    if (result.skippedCount > 0) {
      errors.push(
        `Skipped ${result.skippedCount}/${result.rawCount} tribe events (missing title or date)`,
      );
    }

    // Check raw parsed count (before category/date filtering) — if the
    // API returned events but they were all filtered, that's expected
    // behavior, not format drift.
    if (result.events.length === 0 && errors.length === 0) {
      errors.push("LVH3 adapter parsed 0 events from Tribe API — possible site format drift");
      errorDetails.parse = [{ row: 0, error: "Zero events parsed" }];
    }

    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          rawEventsFetched: result.rawCount,
          eventsNormalized: result.events.length,
          categorySkipped,
          skippedCount: result.skippedCount,
          categoryFilteredCount: result.categoryFilteredCount,
          fetchDurationMs: result.fetchDurationMs,
        },
      },
      days,
    );
  }
}
