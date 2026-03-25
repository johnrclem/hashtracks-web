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
} from "../utils";

// ── Config shape ──

interface FrankfurtHashConfig {
  /** Full URL for the archive page; derived from source URL if omitted */
  archiveUrl?: string;
  /** [[regex, kennelTag], ...] — first match wins */
  kennelPatterns: [string, string][];
  /** Fallback kennel tag when no pattern matches */
  defaultKennelTag: string;
}

// ── Compiled pattern helper ──

interface CompiledPattern {
  re: RegExp;
  tag: string;
}

function compileKennelPatterns(patterns: [string, string][]): CompiledPattern[] {
  const compiled: CompiledPattern[] = [];
  for (const [regex, tag] of patterns) {
    try {
      compiled.push({ re: new RegExp(regex, "i"), tag });
    } catch {
      // Skip malformed patterns
    }
  }
  return compiled;
}

function matchKennelTag(title: string, compiled: CompiledPattern[], defaultTag: string): string {
  for (const { re, tag } of compiled) {
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
  compiledPatterns: CompiledPattern[],
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
  compiledPatterns: CompiledPattern[],
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

// ── Adapter class ──

export class FrankfurtHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const raw = source.config;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("FrankfurtHashAdapter: source.config must be an object");
    }
    const config = raw as unknown as FrankfurtHashConfig;
    if (!config.kennelPatterns || !Array.isArray(config.kennelPatterns)) {
      throw new Error("FrankfurtHashAdapter: missing required config field \"kennelPatterns\"");
    }
    if (!config.defaultKennelTag || typeof config.defaultKennelTag !== "string") {
      throw new Error("FrankfurtHashAdapter: missing required config field \"defaultKennelTag\"");
    }

    const baseUrl = source.url
      ? (() => { try { return new URL(source.url).origin; } catch { return "https://frankfurt-hash.de"; } })()
      : "https://frankfurt-hash.de";

    const compiledPatterns = compileKennelPatterns(config.kennelPatterns);
    const { minDate, maxDate } = buildDateWindow(options?.days);
    const isInWindow = (e: RawEventData) => {
      const eventDate = new Date(e.date + "T12:00:00Z");
      return eventDate >= minDate && eventDate <= maxDate;
    };

    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: ParseError[] = [];

    // Derive archive URL from source URL if not explicitly configured
    const archiveUrl = config.archiveUrl
      ?? `${source.url}?task=archive&filter_reset=1&limit=0`;

    // Fetch upcoming + archive in parallel
    const [upcomingPage, archivePage] = await Promise.all([
      fetchHTMLPage(source.url),
      fetchHTMLPage(archiveUrl),
    ]);

    let upcomingEvents: RawEventData[] = [];
    let archiveEvents: RawEventData[] = [];
    let structureHash: string | undefined;

    // Parse upcoming events
    if (upcomingPage.ok) {
      structureHash = upcomingPage.structureHash;
      try {
        upcomingEvents = parseJEMEventList(
          upcomingPage.html, compiledPatterns, config.defaultKennelTag, baseUrl,
        );
      } catch (err) {
        const msg = `Upcoming parse error: ${err instanceof Error ? err.message : String(err)}`;
        allErrors.push(msg);
        parseErrors.push({ row: 0, section: "upcoming", error: msg });
      }
    } else {
      allErrors.push(...upcomingPage.result.errors);
      if (upcomingPage.result.errorDetails?.fetch) {
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          ...upcomingPage.result.errorDetails.fetch,
        ];
      }
    }

    // Parse archive events
    if (archivePage.ok) {
      try {
        archiveEvents = parseJEMEventList(
          archivePage.html, compiledPatterns, config.defaultKennelTag, baseUrl,
        );
      } catch (err) {
        const msg = `Archive parse error: ${err instanceof Error ? err.message : String(err)}`;
        allErrors.push(msg);
        parseErrors.push({ row: 0, section: "archive", error: msg });
      }
    } else {
      allErrors.push(...archivePage.result.errors);
      if (archivePage.result.errorDetails?.fetch) {
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          ...archivePage.result.errorDetails.fetch,
        ];
      }
    }

    // Combine and dedup — upcoming events win for same date+title
    const upcomingKeys = new Set(
      upcomingEvents.map((e) => `${e.date}|${e.title}`),
    );
    const dedupedArchive = archiveEvents.filter(
      (e) => !upcomingKeys.has(`${e.date}|${e.title}`),
    );

    const allEvents = [...upcomingEvents, ...dedupedArchive];

    // Filter by date window
    const filteredEvents = allEvents.filter(isInWindow);

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    return {
      events: filteredEvents,
      errors: allErrors,
      structureHash,
      errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        upcomingEventsParsed: upcomingEvents.length,
        archiveEventsParsed: archiveEvents.length,
        archiveDeduped: archiveEvents.length - dedupedArchive.length,
        eventsAfterWindow: filteredEvents.length,
      },
    };
  }
}
