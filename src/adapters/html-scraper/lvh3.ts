import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { applyDateWindow, isPlaceholder } from "../utils";
import { fetchTribeEvents, type TribeEvent } from "../tribe-events";

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

/**
 * Routing config read from `Source.config` — describes how to map Tribe
 * category slugs to HashTracks kennel tags. Shared between the recurring
 * adapter and `scripts/backfill-lvh3-history.ts` so both honor the same
 * "most-specific-wins" rule (issue #1479).
 */
export interface Lvh3RoutingConfig {
  baseUrl: string;
  kennelPatterns: [string, string][];
  sharedCalendarCategory: string | undefined;
  otherKennelCategories: string[];
}

/**
 * Read the LVH3 routing config from a seeded Source row. Centralizes the
 * `Source.config` key shape so adding a new routing knob only requires
 * updating this helper + the seed entry.
 */
export function readLvh3RoutingConfig(source: Source): Lvh3RoutingConfig {
  const config = (source.config ?? {}) as Record<string, unknown>;
  return {
    baseUrl: source.url || "https://lvh3.org",
    kennelPatterns: (config.kennelPatterns as [string, string][] | undefined) ?? [],
    sharedCalendarCategory: config.sharedCalendarCategory as string | undefined,
    otherKennelCategories:
      (config.otherKennelCategories as string[] | undefined) ?? [],
  };
}

/**
 * Resolve a kennel tag from event categories using source config patterns.
 *
 * lvh3.org's calendar is shared across multiple kennels and uses `LVHHH` as
 * a co-tag on cross-kennel events (e.g. Rat Pack #27 is tagged both `LVHHH`
 * and `RPHHH`). To stop those events from being misfiled under Las Vegas H3
 * (issue #1479), the resolver implements "most-specific-wins":
 *
 *   1. If any non-shared kennel pattern matches, route to that kennel.
 *   2. Otherwise, if the shared category (`sharedCalendarCategory`) matches
 *      AND no `otherKennelCategories` (kennels we don't ingest yet —
 *      RPHHH, BASHHH, LVRDR) are present, route to the shared kennel.
 *   3. Otherwise return `defaultTag` (typically `null` → skip).
 *
 * Set `sharedCalendarCategory: undefined` for sources where every kennel
 * category is equally specific (legacy first-match-wins behavior).
 */
export function resolveKennelTag(
  categories: string[],
  kennelPatterns: [string, string][],
  defaultTag: string | null,
  options?: { sharedCalendarCategory?: string; otherKennelCategories?: string[] },
): string | null {
  const lowerCats = new Set(categories.map((c) => c.toLowerCase()));
  const shared = options?.sharedCalendarCategory?.toLowerCase();
  const otherKennels = (options?.otherKennelCategories ?? []).map((s) => s.toLowerCase());

  let sharedTag: string | null = null;
  for (const [slug, tag] of kennelPatterns) {
    const lowerSlug = slug.toLowerCase();
    if (!lowerCats.has(lowerSlug)) continue;
    if (shared && lowerSlug === shared) {
      sharedTag = tag;
      continue;
    }
    return tag;
  }
  if (sharedTag !== null) {
    const hasOtherKennel = otherKennels.some((s) => lowerCats.has(s));
    if (!hasOtherKennel) return sharedTag;
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
  // NOSONAR — description is trusted fetcher output, patterns are anchored with \s*; no user-supplied input.
  const m = /(?:^|\n)\s*Start(?:ing)?\s*location:\s*([^\n]+)/im.exec(description);
  if (!m?.[1]) return undefined;
  // Strip trailing "@ <digit>…" time markers only — '@' inside a venue name survives.
  const trimmed = m[1].trim().replace(/\s+@\s*\d.*$/, ""); // NOSONAR — trailing-time stripper, digit-anchored.
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
  // NOSONAR — description is trusted fetcher output; pattern anchors `Hares?` + separator with linear backtracking.
  const m = /(?:^|\n)\s*Hares?\s*[-:]\s*([^\n]+)/im.exec(description);
  if (!m?.[1]) return undefined;
  const value = m[1].trim().replace(/\s*\(IYKYK\)\s*$/i, "").trim(); // NOSONAR — trailing-marker stripper, anchored to end.
  if (!value || value.length >= 200 || isPlaceholder(value)) return undefined;
  return value;
}

/**
 * Build a normalized RawEventData from a Tribe event.
 *
 * Description-based `location` and `hares` extractors run only when
 * `kennelTag === "ass-h3"` — both are fingerprint inputs, so applying them
 * to lv-h3 events (which have never carried them) would re-fingerprint
 * existing LVHHH RawEvents and create duplicates on the next scrape.
 *
 * Shared between `LVH3Adapter.fetch()` and `scripts/backfill-ass-h3-history.ts`
 * to keep the per-event mapping (field order, fallback precedence, extractor
 * gating) in exactly one place.
 */
export function buildLvh3RawEvent(
  e: TribeEvent,
  kennelTag: string,
  baseUrl: string,
): RawEventData {
  const isAssh3 = kennelTag === "ass-h3";
  return {
    date: e.date,
    startTime: e.allDay ? undefined : e.startTime,
    kennelTags: [kennelTag],    title: e.title,
    runNumber: extractLvRunNumber(e.title ?? ""),
    description: e.description,
    location:
      e.location ||
      e.venue ||
      (isAssh3 ? extractLocationFromDescription(e.description) : undefined),
    hares: isAssh3 ? extractHaresFromDescription(e.description) : undefined,
    sourceUrl: e.url ?? baseUrl,
  };
}

/**
 * SourceAdapter for lvh3.org — dispatches Tribe Events Calendar REST API
 * results into per-kennel RawEvents via category-slug routing. See the
 * module header for the list of kennels this source feeds and why the
 * adapter uses REST (the iCal feed is broken upstream).
 */
export class LVH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  /**
   * Fetch and normalize upcoming events within `options.days` (default 365).
   * Events whose category doesn't match any configured kennelPattern are
   * skipped; description-based location/hares fallbacks apply only to
   * ASS H3 to preserve fingerprint stability for LVHHH.
   */
  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const { baseUrl, kennelPatterns, sharedCalendarCategory, otherKennelCategories } =
      readLvh3RoutingConfig(source);

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
      // LVHHH is co-tagged on cross-kennel events (Rat Pack #27, joint Green
      // Mess), so `sharedCalendarCategory` + `otherKennelCategories` make
      // routing "most-specific-wins" — see resolveKennelTag's docstring.
      const kennelTag = resolveKennelTag(e.categorySlugs, kennelPatterns, null, {
        sharedCalendarCategory,
        otherKennelCategories,
      });
      if (!kennelTag) {
        categorySkipped++;
        continue;
      }

      // buildLvh3RawEvent gates the description-based location/hares extractors
      // to ass-h3 only — see the helper's docstring for the fingerprint rationale.
      events.push(buildLvh3RawEvent(e, kennelTag, baseUrl));
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
