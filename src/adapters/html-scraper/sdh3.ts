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
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { safeFetch } from "../safe-fetch";
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

/** Raw GPS coordinate string — hares sometimes enter "(lat, lng)" as the address field. */
const GPS_COORDS_RE = /^\s*\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)\s*$/;

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
 * Parse structured "Label: Value" fields from HTML containing
 * <strong>Label:</strong> value<br /> patterns.
 * Shared by hareline event parsing and individual event page enrichment.
 */
export function parseEventFields(fieldsText: string): {
  hares?: string;
  location?: string;
  locationStreet?: string;
  description?: string;
} {
  let hares: string | undefined;
  let location: string | undefined;
  let locationStreet: string | undefined;
  const descParts: string[] = [];

  const lines = fieldsText.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const labelMatch = /^(.+?):\s*(.*)$/.exec(lines[i].trim());
    if (!labelMatch) continue;

    const label = labelMatch[1].trim().toLowerCase();
    let value = labelMatch[2].trim();
    // #1068: Notes is rendered as `<strong>Notes:</strong><br />body` so after
    // <br>→\n the value is empty on the same line and the actual Notes body
    // sits on the following non-label line(s). Pull it forward before the
    // empty-value bail. A single blank line is treated as a paragraph break
    // (joined with " "), so multi-paragraph Notes blocks survive intact; only
    // the next labeled line terminates the capture.
    if (!value && label === "notes") {
      const continuation: string[] = [];
      for (let k = i + 1; k < lines.length; k++) {
        const next = lines[k].trim();
        if (/^(.+?):\s/.test(next)) break;
        if (!next && continuation.length === 0) continue;
        continuation.push(next);
      }
      // Drop trailing blank lines so we don't render dangling whitespace.
      while (continuation.length > 0 && !continuation.at(-1)) {
        continuation.pop();
      }
      if (continuation.length > 0) value = continuation.join(" ").replaceAll(/\s{2,}/g, " ").trim();
    }
    if (!value) continue;

    switch (label) {
      case "hare":
      case "hares":
      case "hare(s)":
        hares = value;
        break;
      case "address": {
        // Strip trail-type prefixes: "A": ..., "B": ..., "A Prime": ...
        location = value.replace(/^"[A-Za-z](?:\s+[A-Za-z]+)*"\s*:\s*/, "");
        // Raw GPS coords (e.g. "(32.7201, -117.118)") are not a useful venue name — drop them.
        if (GPS_COORDS_RE.test(location)) {
          location = undefined;
          break;
        }
        // Collect continuation lines (street, city/state/zip) — lines without a label
        const addressLines = [location];
        for (let k = i + 1; k < lines.length; k++) {
          const nextLine = lines[k].trim();
          if (!nextLine || /^(.+?):/.test(nextLine)) break;
          // Skip "United States" / "US" country lines
          if (/^(?:United States|US|USA)$/i.test(nextLine)) continue;
          addressLines.push(nextLine);
        }
        if (addressLines.length > 1) {
          locationStreet = addressLines.join(", ");
        }
        break;
      }
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
      case "on after":
        descParts.push(`On After: ${value}`);
        break;
      case "notes":
        descParts.push(value);
        break;
    }
  }

  return {
    hares,
    location,
    locationStreet,
    description: descParts.length > 0 ? descParts.join(" | ") : undefined,
  };
}

/** Extract the event detail page URL from the float-right span. */
function extractEventPageUrl(
  $dt: cheerio.Cheerio<AnyNode>,
  $: cheerio.CheerioAPI,
  baseUrl: string,
): string | undefined {
  const floatSpan = $dt.find('> span[style*="float"]').first();
  const href = floatSpan
    .find("a")
    .filter((_i, a) => /\/e\/event-/.test($(a).attr("href") ?? ""))
    .first()
    .attr("href");
  if (!href) return undefined;
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** Extract the first Google Maps link from a Cheerio container. */
function extractMapLink($container: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI): string | undefined {
  return $container.find("a").filter((_j, a) => {
    const href = $(a).attr("href") ?? "";
    return /maps|goo\.gl/i.test(href);
  }).first().attr("href") || undefined;
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
  baseUrl = "https://sdh3.com",
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
    const dateSpan = $dt.find("> strong").nextAll("span").first();
    const dateText = decodeEntities(dateSpan.text()).trim();
    if (!dateText) return;

    const parsed = parseHarelineDate(dateText);
    if (!parsed) return;

    // Extract structured fields from the <div> inside the <dt>
    const fieldsDiv = $dt.find("div").first();
    const fieldsHtml = fieldsDiv.html() ?? "";
    const fieldsText = stripHtmlTags(fieldsHtml, "\n");

    const { hares, location, locationStreet, description } = parseEventFields(fieldsText);

    const locationUrl = extractMapLink(fieldsDiv, $);
    const sourceUrl = extractEventPageUrl($dt, $, baseUrl);
    // Extract title: first non-labeled line in the div text is the run title
    // (the <strong> element contains the kennel display name, not the trail name)
    let title: string | undefined;
    const titleLines = fieldsText.split("\n");
    for (const line of titleLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Stop at labeled fields (e.g., "Hare(s): ...")
      if (/^.+?:\s/.test(trimmed)) break;
      title = trimmed;
      break;
    }

    events.push({
      date: parsed.date,
      kennelTags: [kennelTag],      startTime: parsed.startTime,
      title,
      hares,
      location,
      locationStreet,
      locationUrl,
      description,
      sourceUrl,
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
      kennelTags: [kennelTag],      startTime: entry.startTime,
      title: entry.title,
      sourceUrl: entry.sourceUrl,
    });
  });

  return events;
}

/**
 * Whether an event needs detail-page enrichment. Fetches if it has a sourceUrl AND
 * either has no title OR is missing both hares and location. Events with partial
 * structured data (e.g. location but no hares) are left alone to bound fetch volume.
 */
function shouldEnrichEvent(event: RawEventData): boolean {
  if (!event.sourceUrl) return false;
  if (!event.title) return true;
  return !event.hares && !event.location;
}

/** First non-labeled line of event-fields text becomes the trail title (mirrors parseHarelineEvents). */
function extractTitleFromFieldsText(fieldsText: string): string | undefined {
  for (const line of fieldsText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^.+?:\s/.test(trimmed)) break; // hit a labeled field
    return trimmed;
  }
  return undefined;
}

/**
 * Enrich events by fetching individual event detail pages. Used for both:
 *  - history entries that only have date/title/kennel from the index page
 *  - hareline entries that are missing the trail title (some events render only labeled fields)
 */
export async function enrichEventsFromDetail(
  events: RawEventData[],
): Promise<{ enriched: number; errors: string[] }> {
  const errors: string[] = [];
  let enriched = 0;

  const toEnrich = events.filter(shouldEnrichEvent);
  if (toEnrich.length === 0) return { enriched: 0, errors: [] };

  const BATCH_SIZE = 5;
  for (let b = 0; b < toEnrich.length; b += BATCH_SIZE) {
    const batch = toEnrich.slice(b, b + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(async (event) => {
        const response = await safeFetch(event.sourceUrl!, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${event.sourceUrl}`);
        }
        return { html: await response.text(), event };
      }),
    );

    for (const result of batchResults) {
      if (result.status === "rejected") {
        errors.push(String(result.reason));
        continue;
      }

      const { html, event } = result.value;
      const $ = cheerio.load(html);

      // Event detail pages have structured fields in a <div> with a <span> child
      // Use the same <strong>Label:</strong> value pattern as the hareline
      const contentDiv = $("div[style*='margin-left']").first();
      const fieldsHtml = contentDiv.html() ?? "";
      const fieldsText = stripHtmlTags(fieldsHtml, "\n");
      const fields = parseEventFields(fieldsText);

      let wasEnriched = false;
      if (!event.title) {
        const detailTitle = extractTitleFromFieldsText(fieldsText);
        if (detailTitle) { event.title = detailTitle; wasEnriched = true; }
      }
      if (fields.hares) { event.hares = fields.hares; wasEnriched = true; }
      if (fields.location) { event.location = fields.location; wasEnriched = true; }
      if (fields.locationStreet) { event.locationStreet = fields.locationStreet; wasEnriched = true; }
      if (fields.description && !event.description) { event.description = fields.description; wasEnriched = true; }

      const mapLink = extractMapLink(contentDiv, $);
      if (mapLink) { event.locationUrl = mapLink; wasEnriched = true; }
      if (wasEnriched) enriched++;
    }
  }

  return { enriched, errors };
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
    const isInWindow = (e: RawEventData) => {
      const eventDate = new Date(e.date + "T12:00:00Z");
      return eventDate >= minDate && eventDate <= maxDate;
    };

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
        harelineEvents = parseHarelineEvents(harelinePage.html, config, baseUrl);
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

    // ── Step 2b: Enrich events from detail pages ──
    // History events only have date/title/kennel from the index. Hareline events occasionally
    // ship without a title (some events render only labeled fields). Enrichment fetches the
    // event detail page and fills in title/hares/location/description.
    // Enrichment is best-effort; failures are logged but never block the scrape so a
    // single 500 from a detail page can't mark the source unhealthy.
    let historyEnriched = 0;
    if (historyEvents.length > 0) {
      const windowedHistory = historyEvents.filter(isInWindow);
      const enrichResult = await enrichEventsFromDetail(windowedHistory);
      historyEnriched = enrichResult.enriched;
      if (enrichResult.errors.length > 0) {
        console.warn("[sdh3] history enrichment errors:", enrichResult.errors.slice(0, 3));
      }
    }
    // Enrich hareline events that are missing a title
    const harelineNeedingEnrichment = harelineEvents.filter(
      (e) => isInWindow(e) && e.sourceUrl && !e.title,
    );
    if (harelineNeedingEnrichment.length > 0) {
      const enrichResult = await enrichEventsFromDetail(harelineNeedingEnrichment);
      if (enrichResult.errors.length > 0) {
        console.warn("[sdh3] hareline enrichment errors:", enrichResult.errors.slice(0, 3));
      }
    }

    // ── Step 3: Combine and dedup ──
    // Hareline events win when both pages have the same date+kennel
    const harelineKeys = new Set(
      harelineEvents.map((e) => `${e.date}|${e.kennelTags[0]}`),
    );
    const dedupedHistory = historyEvents.filter(
      (e) => !harelineKeys.has(`${e.date}|${e.kennelTags[0]}`),
    );

    const allEvents = [...harelineEvents, ...dedupedHistory];

    // ── Step 4: Filter by date window ──
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
        harelineEventsParsed: harelineEvents.length,
        historyEventsParsed: historyEvents.length,
        historyEnriched,
        historyDeduped: historyEvents.length - dedupedHistory.length,
        eventsAfterWindow: filteredEvents.length,
        includeHistory: config.includeHistory ?? false,
      },
    };
  }
}
