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
 * Extract run number from a TH3 post title.
 * "TH3 #1060 – October 3, 2024" → 1060
 * "TH3 #1058" → 1058
 */
export function parseRunNumber(title: string): number | null {
  const match = title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a date from TH3 title format.
 * "TH3 #1060 – October 3, 2024" → "2024-10-03"
 * "TH3 #1058 – September 19, 2024" → "2024-09-19"
 * Also handles: "February 15, 2026", "Feb 15, 2026"
 */
export function parseDateFromTitle(title: string): string | null {
  const match = title.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a date from a WordPress <time datetime="..."> attribute value.
 * "2024-10-03T19:00:00-05:00" → "2024-10-03"
 */
export function parseDateFromDatetime(datetime: string): string | null {
  const match = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
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

  // Extract "WHERE" field → location
  const whereMatch = bodyText.match(
    new RegExp(`WHERE${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is"),
  );
  if (whereMatch) {
    result.location = whereMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "HARE" or "HARES" field
  const hareMatch = bodyText.match(
    new RegExp(`HARES?${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is"),
  );
  if (hareMatch) {
    result.hares = hareMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "HASH CASH" field
  const cashMatch = bodyText.match(
    new RegExp(`HASH CASH${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is"),
  );
  if (cashMatch) {
    result.hashCash = cashMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract "WALKER'S TRAIL" field
  const walkerMatch = bodyText.match(
    new RegExp(`WALKER'?S TRAIL${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is"),
  );
  if (walkerMatch) {
    result.walkersTrail = walkerMatch[1].trim().replace(/\s+/g, " ");
  }

  // Extract time from "WHEN" field
  const whenMatch = bodyText.match(
    new RegExp(`WHEN${fieldDelimiter}(.+?)(?=(?:${labelPattern})${fieldDelimiter}|$)`, "is"),
  );
  if (whenMatch) {
    const whenText = whenMatch[1].trim();
    const parsed = parseTimeString(whenText);
    if (parsed) result.startTime = parsed;
  }

  return result;
}

/**
 * Parse time from text like "7:00 PM", "7:30 PM", "19:00".
 */
export function parseTimeString(text: string): string | null {
  // Try 12-hour format via shared utility
  const result12 = parse12HourTime(text);
  if (result12) return result12;

  // Try 24-hour format: "19:00"
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

  private maxPages = 3;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://chicagoth3.com/";

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
