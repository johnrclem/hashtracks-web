import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
} from "../types";
import { chronoParseDate, googleMapsSearchUrl } from "../utils";
import { parseRunNumber, parseDateFromDatetime, parseTimeString, fetchWordPressBlogEvents } from "./chicago-shared";
export { parseRunNumber, parseDateFromDatetime, parseTimeString };

const mapsUrl = googleMapsSearchUrl;

/**
 * Parse a date from TH3 title format using chrono-node.
 * Handles: "TH3 #1060 – October 3, 2024", "February 15, 2026", "Feb 15, 2026"
 */
export function parseDateFromTitle(title: string): string | null {
  return chronoParseDate(title, "en-US");
}

/**
 * Parse the body content of a TH3 WordPress post to extract labeled fields.
 * TH3 uses labels: HARE, WHERE, WHEN, HASH CASH, WALKER'S TRAIL
 */
export function parseBodyFields(bodyText: string): {
  hares?: string;
  location?: string;
  hashCash?: string;
  startTime?: string;
  walkersTrail?: string;
} {
  const result: {
    hares?: string;
    location?: string;
    hashCash?: string;
    startTime?: string;
    walkersTrail?: string;
  } = {};

  // Known labels as delimiters
  const labels = ["HARE", "HARES", "WHERE", "WHEN", "HASH CASH", "WALKER'?S TRAIL", "ON-?OUT"];
  const labelPattern = labels.join("|");
  const fieldDelimiter = "\\s*[:\\-–—]\\s*";

  // Simple fields: regex label → result key
  const simpleFields: Array<[string, keyof typeof result]> = [
    ["WHERE", "location"],
    ["HARES?", "hares"],
    ["HASH CASH", "hashCash"],
    ["WALKER'?S TRAIL", "walkersTrail"],
  ];

  for (const [label, key] of simpleFields) {
    const match = new RegExp(`${label}${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is").exec(bodyText);
    if (match) {
      result[key] = match[1].trim().replace(/\s+/g, " ");
    }
  }

  // Extract time from "WHEN" field (special: requires parseTimeString)
  const whenMatch = new RegExp(`WHEN${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is").exec(bodyText);
  if (whenMatch) {
    const whenText = whenMatch[1].trim();
    const parsed = parseTimeString(whenText);
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

  // Date: prefer title-based parsing (TH3 titles include dates),
  // then <time datetime="...">, then fallback to date text
  let date: string | null = parseDateFromTitle(titleText);

  if (!date) {
    const timeEl = $article.find("time[datetime]").first();
    if (timeEl.length) {
      const datetime = timeEl.attr("datetime") ?? "";
      date = parseDateFromDatetime(datetime);
    }
  }
  if (!date) {
    const dateText = $article.find(".entry-date, time, .posted-on").first().text().trim();
    if (dateText) {
      date = parseDateFromTitle(dateText);
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
  if (fields.hashCash) descParts.push(`Hash Cash: ${fields.hashCash}`);
  if (fields.walkersTrail) descParts.push(`Walker's Trail: ${fields.walkersTrail}`);
  const description = descParts.length > 0 ? descParts.join(". ") : undefined;

  return {
    date,
    kennelTag: "TH3",
    runNumber,
    title: titleText,
    hares: fields.hares,
    location: fields.location,
    locationUrl,
    startTime: fields.startTime ?? "19:00", // TH3 always meets at 7 PM
    sourceUrl,
    description,
  };
}

/**
 * Thirstday Hash (TH3) WordPress Blog Scraper
 *
 * Scrapes chicagoth3.com for hash run details. The site is a WordPress blog
 * where each run is posted as an <article> with structured labels in the body
 * (HARE, WHERE, WHEN, HASH CASH, WALKER'S TRAIL).
 * Title format: "TH3 #[number] – [Month Day, Year]"
 * Supports pagination via WordPress /page/N/ URLs.
 */
export class ChicagoTH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    return fetchWordPressBlogEvents(source, parseArticle, "https://chicagoth3.com/");
  }
}
