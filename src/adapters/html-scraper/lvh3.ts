import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { applyDateWindow, isPlaceholder } from "../utils";
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

/**
 * Pub-crawl events on lvh3.org encode the start venue in the description body
 * rather than the Tribe Venue widget (e.g. "Start location: Modest Brewing Company…").
 * Used as a fallback when `location` / `venue` aren't populated.
 */
export function extractLocationFromDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;
  const m = /(?:^|\n)\s*Start(?:ing)?\s*location:\s*([^\n]+)/im.exec(description);
  if (!m?.[1]) return undefined;
  // Strip trailing "@ <digit>…" time markers only — '@' inside a venue name survives.
  const trimmed = m[1].trim().replace(/\s+@\s*\d.*$/, "");
  return trimmed || undefined;
}

/**
 * Tribe's `organizer` field is empty for lvh3.org ASSH3 events, but descriptions
 * contain free text like "Hares- DIMA, Just Rosa" or "Hares: Symphomaniac".
 * Placeholder-only values (e.g. "???", "TBD") are dropped.
 */
export function extractHaresFromDescription(
  description: string | undefined,
): string | undefined {
  if (!description) return undefined;
  const m = /(?:^|\n)\s*Hares?\s*[-:]\s*([^\n]+)/im.exec(description);
  if (!m?.[1]) return undefined;
  const value = m[1].trim().replace(/\s*\(IYKYK\)\s*$/i, "").trim();
  if (!value || value.length >= 200 || isPlaceholder(value)) return undefined;
  return value;
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

    // Ask the API to go back as far as the adapter's date window;
    // applyDateWindow enforces the final bound.
    const days = options?.days ?? source.scrapeDays ?? 365;
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
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
        location: e.location || e.venue || extractLocationFromDescription(e.description),
        // Only extract hares for ASS H3 — lv-h3 events have never stored a
        // `hares` field, so adding one globally would re-fingerprint existing
        // LVHHH RawEvents and create duplicates on the next scrape.
        hares: kennelTag === "ass-h3" ? extractHaresFromDescription(e.description) : undefined,
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
