/**
 * Frankfurt Hash House Harriers (FH3) Website Adapter
 *
 * Scrapes frankfurt-hash.de (Joomla + JEM — Joomla Events Manager) for hash events.
 *
 * Two pages share the same `.jem-event` <li> structure:
 *   1. /coming-runs/category/3:next-fh3-run — upcoming events
 *   2. /coming-runs/category/3?task=archive&filter_reset=1&limit=0 — full archive (1,098+ events, 2008–present)
 *
 * Config-driven multi-kennel support via kennelPatterns (regex → tag) with defaultKennelTag fallback.
 * 5 kennels share this source: FH3, FFMH3, SHITS, DOM, Bike Hash.
 */

import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import {
  fetchHTMLPage,
  buildDateWindow,
  decodeEntities,
  validateSourceConfig,
  compilePatterns,
  type FetchHTMLResult,
} from "../utils";

// ── Config shape ──

interface FrankfurtHashConfig {
  /** Full URL for the archive page */
  archiveUrl: string;
  /** [[regex, kennelTag], ...] — first match wins */
  kennelPatterns: [string, string][];
  /** Fallback kennel tag when no pattern matches */
  defaultKennelTag: string;
}

// ── Pattern matching helper ──

function matchKennelTag(title: string, compiled: [RegExp, string][], defaultTag: string): string {
  for (const [re, tag] of compiled) {
    if (re.test(title)) return tag;
  }
  return defaultTag;
}

// ── Exported helpers (for unit testing) ──

/**
 * Parse a single JEM event <li> element into a RawEventData.
 * Returns null if required fields (date, title) are missing.
 */
export function parseJEMEvent(
  $li: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  compiledPatterns: [RegExp, string][],
  defaultKennelTag: string,
  baseUrl: string,
): RawEventData | null {
  // Extract date from [itemprop="startDate"] content attribute (ISO format: "2026-03-29T14:30")
  const startDateEl = $li.find('[itemprop="startDate"]');
  const isoDateTime = startDateEl.attr("content");
  if (!isoDateTime) return null;

  const [datePart, timePart] = isoDateTime.split("T");
  if (!datePart || !/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;

  // startTime in HH:MM format
  const startTime = timePart && /^\d{2}:\d{2}/.test(timePart)
    ? timePart.slice(0, 5)
    : undefined;

  // Extract title from .jem-event-title h4 a
  const titleLink = $li.find(".jem-event-title h4 a").first();
  const title = decodeEntities(titleLink.text()).trim();
  if (!title) return null;

  // Extract sourceUrl from href
  const href = titleLink.attr("href");
  const sourceUrl = href
    ? (() => { try { return new URL(href, baseUrl).toString(); } catch { return undefined; } })()
    : undefined;

  // Extract venue from .jem-event-venue a
  const venueEl = $li.find(".jem-event-venue a").first();
  const location = venueEl.length
    ? decodeEntities(venueEl.text()).trim() || undefined
    : undefined;

  // Extract run number from title: "#2114" or "Run 2114"
  const runMatch = /#(\d+)|Run\s+(\d+)/i.exec(title);
  const runNumber = runMatch
    ? Number.parseInt(runMatch[1] ?? runMatch[2], 10)
    : undefined;

  // Resolve kennel tag from title using compiled patterns
  const kennelTag = matchKennelTag(title, compiledPatterns, defaultKennelTag);

  return {
    date: datePart,
    kennelTag,
    runNumber,
    title,
    location,
    startTime,
    sourceUrl,
  };
}

/**
 * Parse a page of JEM events (both upcoming and archive pages share this structure).
 * Returns an array of RawEventData.
 */
export function parseJEMEventList(
  html: string,
  compiledPatterns: [RegExp, string][],
  defaultKennelTag: string,
  baseUrl: string,
): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("li.jem-event").each((_i, el) => {
    const event = parseJEMEvent($(el), $, compiledPatterns, defaultKennelTag, baseUrl);
    if (event) events.push(event);
  });

  return events;
}

// ── Page fetch processing helper ──

function processPageFetch(
  page: FetchHTMLResult,
  section: string,
  compiledPatterns: [RegExp, string][],
  defaultTag: string,
  baseUrl: string,
  errors: string[],
  errorDetails: ErrorDetails,
  parseErrors: ParseError[],
): { events: RawEventData[]; structureHash?: string } {
  if (!page.ok) {
    errors.push(...page.result.errors);
    if (page.result.errorDetails?.fetch) {
      errorDetails.fetch = [
        ...(errorDetails.fetch ?? []),
        ...page.result.errorDetails.fetch,
      ];
    }
    return { events: [] };
  }

  try {
    const events = parseJEMEventList(page.html, compiledPatterns, defaultTag, baseUrl);
    return { events, structureHash: page.structureHash };
  } catch (err) {
    const msg = `${section} parse error: ${err instanceof Error ? err.message : String(err)}`;
    errors.push(msg);
    parseErrors.push({ row: 0, section: section.toLowerCase(), error: msg });
    return { events: [], structureHash: page.structureHash };
  }
}

// ── Adapter class ──

export class FrankfurtHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<FrankfurtHashConfig>(
      source.config,
      "FrankfurtHashAdapter",
      { kennelPatterns: "array", defaultKennelTag: "string", archiveUrl: "string" },
    );

    const baseUrl = source.url
      ? (() => { try { return new URL(source.url).origin; } catch { return "https://frankfurt-hash.de"; } })()
      : "https://frankfurt-hash.de";

    // Compile kennel patterns once (same approach as PhoenixHHHAdapter)
    const patternStrings = config.kennelPatterns.map(([p]) => p);
    const compiledRegexes = compilePatterns(patternStrings, "i");
    const compiledPatterns: [RegExp, string][] = compiledRegexes.map((re, i) => [
      re,
      config.kennelPatterns[i][1],
    ]);
    const { minDate, maxDate } = buildDateWindow(options?.days);
    const isInWindow = (e: RawEventData) => {
      const eventDate = new Date(e.date + "T12:00:00Z");
      return eventDate >= minDate && eventDate <= maxDate;
    };

    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: ParseError[] = [];

    // Fetch upcoming + archive in parallel
    const [upcomingPage, archivePage] = await Promise.all([
      fetchHTMLPage(source.url),
      fetchHTMLPage(config.archiveUrl),
    ]);

    const upcoming = processPageFetch(
      upcomingPage, "Upcoming", compiledPatterns, config.defaultKennelTag,
      baseUrl, allErrors, errorDetails, parseErrors,
    );
    const archive = processPageFetch(
      archivePage, "Archive", compiledPatterns, config.defaultKennelTag,
      baseUrl, allErrors, errorDetails, parseErrors,
    );

    // Combine and dedup — upcoming events win for same date+title
    const upcomingKeys = new Set(
      upcoming.events.map((e) => `${e.date}|${e.title}`),
    );
    const dedupedArchive = archive.events.filter(
      (e) => !upcomingKeys.has(`${e.date}|${e.title}`),
    );

    const allEvents = [...upcoming.events, ...dedupedArchive];

    // Filter by date window
    const filteredEvents = allEvents.filter(isInWindow);

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    return {
      events: filteredEvents,
      errors: allErrors,
      structureHash: upcoming.structureHash,
      errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        upcomingEventsParsed: upcoming.events.length,
        archiveEventsParsed: archive.events.length,
        archiveDeduped: archive.events.length - dedupedArchive.length,
        eventsAfterWindow: filteredEvents.length,
      },
    };
  }
}
