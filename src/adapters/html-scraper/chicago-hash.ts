import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
} from "../types";
import { MONTHS, googleMapsSearchUrl } from "../utils";
import {
  parseRunNumber,
  parseDateFromDatetime,
  parseTimeString,
  fetchWordPressBlogEvents,
} from "./chicago-shared";

// Re-export shared functions for test compatibility
export { parseRunNumber, parseDateFromDatetime, parseTimeString };

const mapsUrl = googleMapsSearchUrl;

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

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    return fetchWordPressBlogEvents(source, parseArticle, "https://chicagohash.org/");
  }
}
