import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import * as cheerio from "cheerio";
import type { Element, Text } from "domhandler";
import {
  chronoParseDate,
  parse12HourTime,
  isPlaceholder,
  decodeEntities,
} from "../utils";

/**
 * Parse a SOH4 trail page HTML to extract structured event fields.
 *
 * The Events Manager plugin renders fields as:
 *   <strong>Label:</strong> value text </br>
 *   <strong>Label:</strong> <a href="...">linked value</a> </br>
 *
 * All fields are inside a container with class `em-event-single` or the
 * general page content area.
 */
export function parseTrailPageHtml(html: string): {
  title?: string;
  date?: string;
  startTime?: string;
  description?: string;
  location?: string;
  locationUrl?: string;
  hares?: string;
  hashCash?: string;
  theme?: string;
  onAfter?: string;
} {
  const $ = cheerio.load(html);

  // Find the event content container
  const container = $(".em-event-single").first();
  if (container.length === 0) {
    return {};
  }

  // Extract labeled fields from <strong>Label:</strong> patterns
  const fields: Record<string, { text: string; href?: string }> = {};
  container.find("strong").each((_i, el) => {
    const label = $(el).text().trim();
    if (!label.endsWith(":")) return;
    const key = label.slice(0, -1).toLowerCase(); // "Hares:" → "hares"

    // Walk siblings after <strong> to collect value text and links
    let text = "";
    let href: string | undefined;
    let node = el.nextSibling;
    while (node) {
      if (node.type === "tag") {
        const tag = (node as Element).tagName?.toLowerCase();
        if (tag === "br" || tag === "strong") break;
        // Extract text from any tag (a, span, em, etc.)
        const $node = $(node);
        text += $node.text().trim();
        // Capture href from <a> tags (or nested <a> inside other tags)
        if (tag === "a") {
          href = $node.attr("href");
        } else {
          const nestedLink = $node.find("a").last();
          if (nestedLink.length) href = nestedLink.attr("href");
        }
      } else if (node.type === "text") {
        text += (node as Text).data || "";
      }
      node = node.nextSibling;
    }
    text = text.trim();
    if (text) fields[key] = { text, href };
  });

  // Extract date from page header (e.g., "Saturday - March 21, 2026 - 2:09 pm")
  const headerText = container.find(".tribe-events-start-date, .em-dates-localised, h1, h2").first().text()
    || container.parent().find("h1, h2").first().text()
    || "";
  // Look for date pattern in header or the surrounding page
  const pageTitle = $("title").text() || "";
  const dateText = headerText || pageTitle;
  const date = chronoParseDate(dateText, "en-US") ?? undefined;

  // Extract title from page <title> or first heading
  const rawTitle = $("h1").first().text().trim()
    || $("title").text().replace(/\s*\|.*$/, "").trim()
    || undefined;

  // Parse start time — SOH4 uses "1:69PM (AKA 2:09 pm)" format
  let startTime: string | undefined;
  const timeText = fields["start time"]?.text;
  if (timeText) {
    // Prefer the "AKA" real time if present (hash humor: "1:69PM" is not a real time)
    const akaMatch = /\(AKA\s+(.+?)\)/i.exec(timeText);
    if (akaMatch) {
      startTime = parse12HourTime(akaMatch[1]);
    }
    if (!startTime) {
      startTime = parse12HourTime(timeText);
    }
  }

  // Extract narrative description (text before the structured fields)
  // Use container.text() directly instead of re-serializing HTML through stripHtmlTags
  const fullText = decodeEntities(container.text().replace(/\s+/g, " "));
  // Find where the structured labels start
  const firstLabelIdx = fullText.search(/\bHares?\s*:|Location\s*:|Start Time\s*:|Hash Cash\s*:|Theme\s*:|On[ -]?After\s*:/i);
  let description = firstLabelIdx > 0
    ? fullText.slice(0, firstLabelIdx).trim()
    : undefined;
  // Clean description
  if (description) {
    description = description
      .replace(/https?:\/\/(?:maps\.app\.goo\.gl|maps\.google\.com|www\.google\.com\/maps)\S*/g, "")
      .replace(/Please include hash name and date of trail in description\.?/gi, "")
      .trim() || undefined;
  }

  // Map extracted fields
  const hares = fields["hares"]?.text || fields["hare"]?.text;
  const location = fields["location"]?.text;
  const locationUrl = fields["location"]?.href;
  const hashCash = fields["hash cash"]?.text;
  const theme = fields["theme"]?.text;
  const onAfter = fields["on-after"]?.text;

  return {
    title: rawTitle,
    date,
    startTime,
    description,
    location: location && !isPlaceholder(location) ? location : undefined,
    locationUrl: location && !isPlaceholder(location) ? locationUrl : undefined,
    hares: hares && !isPlaceholder(hares) ? hares : undefined,
    hashCash,
    theme,
    onAfter,
  };
}

/**
 * Parse RSS XML to extract trail URLs.
 * Returns an array of { url, title } for each <item> in the feed.
 */
export function parseRssItems(xml: string): Array<{ url: string; title: string }> {
  const $ = cheerio.load(xml, { xml: true });
  const items: Array<{ url: string; title: string }> = [];

  $("item").each((_i, el) => {
    const link = $(el).find("link").first().text().trim();
    const title = $(el).find("title").first().text().trim();
    if (link) {
      items.push({ url: link, title });
    }
  });

  return items;
}

/**
 * Extract trail number from a SOH4 trail URL.
 * e.g., "https://www.soh4.com/trails/821/" → 821
 */
export function extractTrailNumber(url: string): number | undefined {
  const match = /\/trails\/(\d+)\/?/.exec(url);
  return match ? parseInt(match[1], 10) : undefined;
}

/**
 * Syracuse On-On-Dog-A Hash House Harriers & Harriettes (SOH4) Adapter
 *
 * Uses a two-phase approach:
 * 1. Fetch RSS feed at /trails/feed/ for trail index (URLs + titles)
 * 2. For each trail, fetch the HTML page and parse structured fields
 *    from <strong>Label:</strong> patterns rendered by Events Manager plugin
 *
 * The structured fields (Hares, Location, Start Time, Hash Cash, Theme,
 * On-After) are in the raw HTML — no browser rendering required.
 */
export class SOH4Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const feedUrl = source.url || "https://www.soh4.com/trails/feed/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // Phase 1: Fetch RSS feed
    const fetchStart = Date.now();
    let rssResponse: Response;
    try {
      rssResponse = await safeFetch(feedUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
      });
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: feedUrl, message }] } };
    }

    if (!rssResponse.ok) {
      const message = `HTTP ${rssResponse.status}: ${rssResponse.statusText}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url: feedUrl, status: rssResponse.status, message }] } };
    }

    const rssXml = await rssResponse.text();
    const structureHash = generateStructureHash(rssXml);
    const items = parseRssItems(rssXml);
    const rssFetchMs = Date.now() - fetchStart;

    // Phase 2: Fetch + parse HTML for each trail (batched, processed inline for GC)
    const BATCH_SIZE = 5;
    const htmlFetchStart = Date.now();
    let htmlFetched = 0;
    for (let b = 0; b < items.length; b += BATCH_SIZE) {
      const batch = items.slice(b, b + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (item) => {
          const trailUrl = item.url.endsWith("/") ? item.url : `${item.url}/`;
          const response = await safeFetch(trailUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
          });
          if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${trailUrl}`);
          }
          const html = await response.text();
          return { html, trailUrl: item.url, rssTitle: item.title };
        }),
      );

      // Process each result immediately so HTML can be GC'd before next batch
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const itemIdx = b + j;
        if (result.status === "rejected") {
          const message = `HTML fetch error for ${items[itemIdx].url}: ${result.reason}`;
          errors.push(message);
          (errorDetails.fetch ??= []).push({ url: items[itemIdx].url, message });
          continue;
        }

        htmlFetched++;
        const { html, trailUrl, rssTitle } = result.value;

        try {
          const fields = parseTrailPageHtml(html);
          let date = fields.date;
          if (!date) {
            // Fall back to parsing date from RSS title
            date = chronoParseDate(rssTitle, "en-US") ?? undefined;
            if (!date) {
              errors.push(`No date found for trail: ${trailUrl}`);
              (errorDetails.parse ??= []).push({ row: itemIdx, error: "No date in HTML or RSS title", rawText: html.slice(0, 2000) });
              continue;
            }
          }

          const trailNumber = extractTrailNumber(trailUrl);

          // Build title from page or RSS title
          let title: string | undefined = fields.title || rssTitle;
          // Clean up title — remove "Trail #NNN" prefix and site suffix
          if (title) {
            title = title.replace(/^Trail\s*#?\d+\s*[-–:]\s*/i, "").trim() || undefined;
          }

          // Build description with extra metadata
          const descParts: string[] = [];
          if (fields.description) descParts.push(fields.description);
          if (fields.theme) descParts.push(`Theme: ${fields.theme}`);
          if (fields.hashCash) descParts.push(`Hash Cash: ${fields.hashCash}`);
          if (fields.onAfter) descParts.push(`On-After: ${fields.onAfter}`);

          const event: RawEventData = {
            date,
            kennelTag: "SOH4",
            runNumber: trailNumber,
            title: title || (trailNumber ? `SOH4 Trail #${trailNumber}` : "SOH4 Trail"),
            description: descParts.length > 0 ? descParts.join("\n") : undefined,
            location: fields.location,
            locationUrl: fields.locationUrl,
            hares: fields.hares,
            startTime: fields.startTime,
            sourceUrl: trailUrl,
          };

          events.push(event);
        } catch (err) {
          errors.push(`Parse error for ${trailUrl}: ${err}`);
          (errorDetails.parse ??= []).push({ row: itemIdx, error: String(err), rawText: html.slice(0, 2000) });
        }
      }
    }
    const htmlFetchMs = Date.now() - htmlFetchStart;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        rssItemsFound: items.length,
        htmlFetched,
        eventsParsed: events.length,
        rssFetchMs,
        htmlFetchMs,
        totalFetchMs: rssFetchMs + htmlFetchMs,
      },
    };
  }
}
