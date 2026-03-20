/**
 * San Diego Hash House Harriers (SDH3) Website Adapter
 *
 * Scrapes sdh3.com for hash events from two pages:
 *
 * 1. /hareline.shtml — upcoming events with rich detail (hares, address, fees, etc.)
 *    Events are in <dt class="hashEvent [KENNEL_CODE]"> elements with structured fields.
 *
 * 2. /history.shtml — 7,649+ historical events in a single <ol>
 *    Each <li> has date/time text and an <a> link with "Title (Kennel Name)".
 *
 * Config-driven multi-kennel support via kennelCodeMap (hareline CSS classes)
 * and kennelNameMap (history parenthetical names).
 */

import * as cheerio from "cheerio";
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
  chronoParseDate,
  parse12HourTime,
  validateSourceConfig,
  buildDateWindow,
  decodeEntities,
  stripHtmlTags,
} from "../utils";

// ── Config shape ──

interface SDH3Config {
  /** Hareline CSS class -> kennelTag, e.g. {"SDH3": "SDH3", "IRH3": "IRH3"} */
  kennelCodeMap: Record<string, string>;
  /** History parenthetical -> kennelTag, e.g. {"San Diego": "SDH3", "Iron Rule": "IRH3"} */
  kennelNameMap: Record<string, string>;
  /** When true, also scrape the history page */
  includeHistory?: boolean;
}

// ── Exported helpers (for unit testing) ──

/**
 * Parse a hareline date/time string like "Friday, March 20, 2026 6:00pm"
 * into a { date: "YYYY-MM-DD", startTime?: "HH:MM" } object.
 */
export function parseHarelineDate(
  dateText: string,
): { date: string; startTime?: string } | null {
  const trimmed = dateText.trim();
  if (!trimmed) return null;

  // Extract time before chrono parsing (chrono may misinterpret "6:00pm" in some contexts)
  const startTime = parse12HourTime(trimmed);

  const date = chronoParseDate(trimmed, "en-US");
  if (!date) return null;

  return { date, startTime };
}

/**
 * Extract a history list entry from raw text and link data.
 *
 * Input format: "Sunday, December 3, 2006 6:30pm:" (text before <a>)
 * Link text: "The Cold Moon (Full Moon)" — kennel in last parenthetical
 * Link href: "/e/event-20061103183000.shtml"
 */
export function extractHistoryEntry(
  liText: string,
  linkText: string,
  linkHref: string,
  baseUrl = "https://sdh3.com",
): {
  date: string;
  startTime?: string;
  title?: string;
  kennelName?: string;
  sourceUrl?: string;
} | null {
  // Parse the date/time from text before the link
  // Strip trailing colon/whitespace
  const cleanedText = liText.replace(/:\s*$/, "").trim();
  if (!cleanedText) return null;

  const startTime = parse12HourTime(cleanedText);
  const date = chronoParseDate(cleanedText, "en-US");
  if (!date) return null;

  // Extract kennel name from last parenthetical in link text
  // Greedy (.*) ensures we match the LAST paren group:
  // "Cinco de Mayo (Part 2) (Iron Rule)" -> kennelName: "Iron Rule"
  let title: string | undefined;
  let kennelName: string | undefined;

  const parenMatch = /^(.*)\(([^)]+)\)\s*$/.exec(linkText.trim());
  if (parenMatch) {
    title = parenMatch[1].trim() || undefined;
    kennelName = parenMatch[2].trim() || undefined;
  } else {
    title = linkText.trim() || undefined;
  }

  // Build sourceUrl from relative or absolute href
  const sourceUrl = linkHref
    ? new URL(linkHref, baseUrl).toString()
    : undefined;

  return { date, startTime, title, kennelName, sourceUrl };
}

/**
 * Parse hareline page HTML into RawEventData[].
 *
 * Events are in <dt class="hashEvent [KENNEL_CODE]"> elements.
 * Kennel code is extracted from the CSS class list (excluding "hashEvent").
 * Structured fields are in <div> children with <strong>Label:</strong> Value pattern.
 */
export function parseHarelineEvents(
  html: string,
  config: SDH3Config,
): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("dt.hashEvent").each((_i, el) => {
    const $dt = $(el);

    // Extract kennel code from CSS classes (e.g., "hashEvent SDH3" -> "SDH3")
    const classes = ($dt.attr("class") ?? "").split(/\s+/);
    const kennelCode = classes.find((c) => c !== "hashEvent" && c.length > 0);
    if (!kennelCode) return;

    // Map kennel code to tag via config; skip unknown kennels
    const kennelTag = config.kennelCodeMap[kennelCode];
    if (!kennelTag) return;

    // Extract kennel name from first <strong>
    // (informational, not used for resolution — kennelTag from CSS class is canonical)

    // Extract date/time from <span style="white-space:nowrap">
    const dateSpan = $dt.find('span[style*="white-space"]').first();
    const dateText = decodeEntities(dateSpan.text()).trim();
    if (!dateText) return;

    const parsed = parseHarelineDate(dateText);
    if (!parsed) return;

    // Extract structured fields from the <div> inside the <dt>
    const fieldsDiv = $dt.find("div").first();
    const fieldsHtml = fieldsDiv.html() ?? "";
    const fieldsText = stripHtmlTags(fieldsHtml, "\n");

    let hares: string | undefined;
    let location: string | undefined;
    let locationUrl: string | undefined;
    let title: string | undefined;
    const descParts: string[] = [];

    // Parse "Label: Value" patterns from the fields div
    const lines = fieldsText.split("\n");
    for (const line of lines) {
      const labelMatch = /^(.+?):\s*(.*)$/.exec(line.trim());
      if (!labelMatch) continue;

      const label = labelMatch[1].trim().toLowerCase();
      const value = labelMatch[2].trim();
      if (!value) continue;

      switch (label) {
        case "hare":
        case "hares":
        case "hare(s)":
          hares = value;
          break;
        case "address":
          location = value;
          break;
        case "run fee":
        case "hash cash":
          descParts.push(`Hash Cash: ${value}`);
          break;
        case "trail type":
          descParts.push(`Trail: ${value}`);
          break;
        case "dog friendly":
          descParts.push(`Dog Friendly: ${value}`);
          break;
        case "notes":
          descParts.push(value);
          break;
      }
    }

    const description = descParts.length > 0 ? descParts.join(" | ") : undefined;

    // Extract Map Link URL from the fields div
    const mapLink = fieldsDiv.find("a").filter((_j, a) => {
      const href = $(a).attr("href") ?? "";
      return /maps|goo\.gl/i.test(href);
    }).first().attr("href");
    if (mapLink) {
      locationUrl = mapLink;
    }

    // Extract title from first <strong> (kennel-specific trail name if present)
    const firstStrong = $dt.find("> strong, > a > strong").first();
    const strongText = decodeEntities(firstStrong.text()).trim();
    // Only use as title if it doesn't look like just a kennel name
    if (strongText && strongText !== kennelCode) {
      title = strongText;
    }

    events.push({
      date: parsed.date,
      kennelTag,
      startTime: parsed.startTime,
      title,
      hares,
      location,
      locationUrl,
      description,
    });
  });

  return events;
}

/**
 * Parse history page HTML into RawEventData[].
 *
 * Structure: <ol><li>date text <a href="/e/...">Title (Kennel Name)</a></li></ol>
 */
export function parseHistoryEvents(
  html: string,
  config: SDH3Config,
  baseUrl = "https://sdh3.com",
): RawEventData[] {
  const $ = cheerio.load(html);
  const events: RawEventData[] = [];

  $("ol > li").each((_i, el) => {
    const $li = $(el);

    // Get the <a> element
    const $link = $li.find("a").first();
    if (!$link.length) return;

    const linkText = decodeEntities($link.text()).trim();
    const linkHref = $link.attr("href") ?? "";

    // Get text before the link (date/time portion) via direct text nodes
    const liText = decodeEntities(
      $li.contents().filter((_j, node) => node.type === "text").text(),
    ).trim();

    const entry = extractHistoryEntry(liText, linkText, linkHref, baseUrl);
    if (!entry) return;

    // Map kennel name to tag via config
    let kennelTag: string | undefined;
    if (entry.kennelName) {
      kennelTag = config.kennelNameMap[entry.kennelName];
    }
    // If no kennel name or no mapping found, skip the event
    if (!kennelTag) return;

    events.push({
      date: entry.date,
      kennelTag,
      startTime: entry.startTime,
      title: entry.title,
      sourceUrl: entry.sourceUrl,
    });
  });

  return events;
}

// ── Adapter class ──

export class SDH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<SDH3Config>(
      source.config,
      "SDH3Adapter",
      { kennelCodeMap: "object", kennelNameMap: "object" },
    );

    const baseUrl = source.url
      ? new URL(source.url).origin
      : "https://sdh3.com";
    const { minDate, maxDate } = buildDateWindow(options?.days);

    const allErrors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const parseErrors: ParseError[] = [];

    // ── Step 1: Fetch hareline (always) and history (when enabled) in parallel ──
    const harelineUrl = `${baseUrl}/hareline.shtml`;
    const historyUrl = `${baseUrl}/history.shtml`;

    const [harelinePage, historyPage] = await Promise.all([
      fetchHTMLPage(harelineUrl),
      config.includeHistory ? fetchHTMLPage(historyUrl) : null,
    ]);

    let harelineEvents: RawEventData[] = [];
    let structureHash: string | undefined;

    if (harelinePage.ok) {
      structureHash = harelinePage.structureHash;
      try {
        harelineEvents = parseHarelineEvents(harelinePage.html, config);
      } catch (err) {
        const msg = `Hareline parse error: ${err instanceof Error ? err.message : String(err)}`;
        allErrors.push(msg);
        parseErrors.push({ row: 0, section: "hareline", error: msg });
      }
    } else {
      allErrors.push(...harelinePage.result.errors);
      if (harelinePage.result.errorDetails?.fetch) {
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          ...harelinePage.result.errorDetails.fetch,
        ];
      }
    }

    // ── Step 2: Process history results ──
    let historyEvents: RawEventData[] = [];

    if (historyPage) {
      if (historyPage.ok) {
        try {
          historyEvents = parseHistoryEvents(historyPage.html, config, baseUrl);
        } catch (err) {
          const msg = `History parse error: ${err instanceof Error ? err.message : String(err)}`;
          allErrors.push(msg);
          parseErrors.push({ row: 0, section: "history", error: msg });
        }
      } else {
        allErrors.push(...historyPage.result.errors);
        if (historyPage.result.errorDetails?.fetch) {
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            ...historyPage.result.errorDetails.fetch,
          ];
        }
      }
    }

    // ── Step 3: Combine and dedup ──
    // Hareline events win when both pages have the same date+kennel
    const harelineKeys = new Set(
      harelineEvents.map((e) => `${e.date}|${e.kennelTag}`),
    );
    const dedupedHistory = historyEvents.filter(
      (e) => !harelineKeys.has(`${e.date}|${e.kennelTag}`),
    );

    const allEvents = [...harelineEvents, ...dedupedHistory];

    // ── Step 4: Filter by date window ──
    const filteredEvents = allEvents.filter((e) => {
      const eventDate = new Date(e.date + "T12:00:00Z");
      return eventDate >= minDate && eventDate <= maxDate;
    });

    if (parseErrors.length > 0) {
      errorDetails.parse = parseErrors;
    }

    return {
      events: filteredEvents,
      errors: allErrors,
      structureHash,
      errorDetails: Object.keys(errorDetails).length > 0 ? errorDetails : undefined,
      diagnosticContext: {
        harelineEventsParsed: harelineEvents.length,
        historyEventsParsed: historyEvents.length,
        historyDeduped: historyEvents.length - dedupedHistory.length,
        eventsAfterWindow: filteredEvents.length,
        includeHistory: config.includeHistory ?? false,
      },
    };
  }
}
