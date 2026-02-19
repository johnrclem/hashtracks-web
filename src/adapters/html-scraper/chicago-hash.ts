import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { MONTHS, googleMapsSearchUrl, parse12HourTime } from "../utils";

const mapsUrl = googleMapsSearchUrl;

/**
 * Extract run number from a CH3 post title.
 * "CH3 #2580" → 2580
 * "CH3 Run #2580 – Groundhog Day Hash" → 2580
 */
export function parseRunNumber(title: string): number | null {
  const match = title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a date from a WordPress <time datetime="..."> attribute value.
 * "2026-02-15T14:00:00-06:00" → "2026-02-15"
 * Also handles: "2026-02-15" (date-only)
 */
export function parseDateFromDatetime(datetime: string): string | null {
  const match = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * Parse a date from text like "February 15, 2026" or "Feb 15, 2026".
 */
export function parseDateFromText(text: string): string | null {
  const match = text.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse the body content of a CH3 WordPress post to extract labeled fields.
 * Fields are delimited by labels like "Venue:", "Hare:", "Hash Cash:", etc.
 * WordPress Gutenberg text runs together — use lookahead to split on labels.
 */
export function parseBodyFields(bodyText: string): {
  hares?: string;
  location?: string;
  hashCash?: string;
  eventName?: string;
  startTime?: string;
} {
  const result: {
    hares?: string;
    location?: string;
    hashCash?: string;
    eventName?: string;
    startTime?: string;
  } = {};

  // Known labels as delimiters (lookahead-based splitting)
  const labels = ["Venue", "Hares?", "Event", "Hash Cash", "Transit", "Shag Wagon", "When", "Where", "Time"];
  const labelPattern = labels.join("|");

  // Extract "Venue:" or "Where:" field
  const venueMatch = bodyText.match(
    new RegExp(`(?:Venue|Where):\\s*(.+?)(?=(?:${labelPattern}):|$)`, "is"),
  );
  if (venueMatch) {
    result.location = venueMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "Hare:" or "Hares:" field
  const hareMatch = bodyText.match(
    new RegExp(`Hares?:\\s*(.+?)(?=(?:${labelPattern}):|$)`, "is"),
  );
  if (hareMatch) {
    result.hares = hareMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "Hash Cash:" field
  const cashMatch = bodyText.match(
    new RegExp(`Hash Cash:\\s*(.+?)(?=(?:${labelPattern}):|$)`, "is"),
  );
  if (cashMatch) {
    result.hashCash = cashMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "Event:" field
  const eventMatch = bodyText.match(
    new RegExp(`Event:\\s*(.+?)(?=(?:${labelPattern}):|$)`, "is"),
  );
  if (eventMatch) {
    result.eventName = eventMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract start time from "When:" or "Time:" field
  const timeMatch = bodyText.match(
    new RegExp(`(?:When|Time):\\s*(.+?)(?=(?:${labelPattern}):|$)`, "is"),
  );
  if (timeMatch) {
    const timeText = timeMatch[1].trim();
    const parsed = parseTimeString(timeText);
    if (parsed) result.startTime = parsed;
  }

  return result;
}

/**
 * Parse time from text like "2:00 PM", "7:00 PM", "14:00".
 */
export function parseTimeString(text: string): string | null {
  // Try 12-hour format via shared utility
  const result12 = parse12HourTime(text);
  if (result12) return result12;

  // Try 24-hour format: "14:00"
  const match24 = text.match(/(\d{2}):(\d{2})/);
  if (match24) {
    return `${match24[1]}:${match24[2]}`;
  }

  return null;
}

/**
 * Parse a single WordPress article element into RawEventData.
 */
export function parseArticle(
  $: CheerioAPI,
  $article: Cheerio<AnyNode>,
  baseUrl: string,
): RawEventData | null {
  // Title: look for entry-title heading with link
  const titleEl = $article.find(".entry-title a, .entry-title, h2 a, h2").first();
  const titleText = titleEl.text().trim();
  if (!titleText) return null;

  // Run number from title
  const runNumber = parseRunNumber(titleText) ?? undefined;

  // Date: prefer <time datetime="..."> attribute, fall back to text
  let date: string | null = null;
  const timeEl = $article.find("time[datetime]").first();
  if (timeEl.length) {
    const datetime = timeEl.attr("datetime") ?? "";
    date = parseDateFromDatetime(datetime);
  }
  if (!date) {
    // Fall back to date text from entry-date or time element text
    const dateText = $article.find(".entry-date, time, .posted-on").first().text().trim();
    if (dateText) {
      date = parseDateFromText(dateText);
    }
  }
  if (!date) return null;

  // Source URL from title link or article permalink
  const titleHref = titleEl.attr("href") ?? titleEl.find("a").attr("href");
  const sourceUrl = titleHref
    ? new URL(titleHref, baseUrl).toString()
    : baseUrl;

  // Parse body content for labeled fields
  const bodyText = $article.find(".entry-content, .post-content, .entry-summary").text();
  const fields = parseBodyFields(bodyText);

  // Look for Google Maps links in the article
  let locationUrl: string | undefined;
  $article.find("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    if (/maps\./i.test(href) || /google\.\w+\/maps/i.test(href)) {
      locationUrl = href;
      return false; // break
    }
  });
  if (!locationUrl && fields.location) {
    locationUrl = mapsUrl(fields.location);
  }

  // Build description from supplementary fields
  const descParts: string[] = [];
  if (fields.eventName) descParts.push(fields.eventName);
  if (fields.hashCash) descParts.push(`Hash Cash: ${fields.hashCash}`);
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  return {
    date,
    kennelTag: "CH3",
    runNumber,
    title: titleText,
    hares: fields.hares,
    location: fields.location,
    locationUrl,
    startTime: fields.startTime,
    sourceUrl,
    description,
  };
}

/**
 * Chicago Hash (CH3) WordPress Blog Scraper
 *
 * Scrapes chicagohash.org for hash run details. The site is a WordPress blog
 * where each run is posted as an <article> with structured labels in the body
 * (Venue, Hare, Event, Hash Cash, Transit, Shag Wagon).
 * Supports pagination via WordPress /page/N/ URLs.
 */
export class ChicagoHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  private maxPages = 3;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://chicagohash.org/";

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let structureHash: string | undefined;
    let pagesFetched = 0;

    const fetchStart = Date.now();
    let currentUrl: string | null = baseUrl;

    while (currentUrl && pagesFetched < this.maxPages) {
      let html: string;
      try {
        const response = await fetch(currentUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
          },
        });
        if (!response.ok) {
          const message = `HTTP ${response.status}: ${response.statusText}`;
          errors.push(message);
          errorDetails.fetch = [
            ...(errorDetails.fetch ?? []),
            { url: currentUrl, status: response.status, message },
          ];
          if (pagesFetched === 0) {
            return { events: [], errors, errorDetails };
          }
          break;
        }
        html = await response.text();
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        errors.push(message);
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: currentUrl, message },
        ];
        if (pagesFetched === 0) {
          return { events: [], errors, errorDetails };
        }
        break;
      }

      // Only generate structure hash from first page
      if (pagesFetched === 0) {
        structureHash = generateStructureHash(html);
      }

      const $ = cheerio.load(html);
      pagesFetched++;

      // Find articles — WordPress uses <article> elements
      const articles = $("article");

      articles.each((i, el) => {
        try {
          const event = parseArticle($, $(el), baseUrl);
          if (event) {
            events.push(event);
          } else {
            const text = $(el).find(".entry-title, h2").text().trim().slice(0, 80);
            errorDetails.parse = [
              ...(errorDetails.parse ?? []),
              { row: i, section: `page-${pagesFetched}`, error: `Could not parse: ${text}` },
            ];
          }
        } catch (err) {
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: `page-${pagesFetched}`, error: String(err) },
          ];
        }
      });

      // Find pagination: WordPress "Older posts" or "next page-numbers" link
      const nextLink = $("a").filter((_i, el) => {
        const text = $(el).text().toLowerCase();
        const classes = $(el).attr("class") ?? "";
        return (
          /older\s*posts/i.test(text) ||
          /next/i.test(text) ||
          classes.includes("next")
        );
      });
      if (nextLink.length > 0) {
        const nextHref = nextLink.first().attr("href");
        currentUrl = nextHref ? new URL(nextHref, baseUrl).toString() : null;
      } else {
        currentUrl = null;
      }
    }

    const fetchDurationMs = Date.now() - fetchStart;

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        pagesFetched,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
