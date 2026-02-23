import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { parse12HourTime } from "../utils";

/**
 * Extract run number from a WordPress post title.
 * "CH3 #2580" → 2580, "TH3 #1060 – October 3, 2024" → 1060
 */
export function parseRunNumber(title: string): number | null {
  const match = title.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse a date from a WordPress <time datetime="..."> attribute value.
 * "2026-02-15T14:00:00-06:00" → "2026-02-15"
 */
export function parseDateFromDatetime(datetime: string): string | null {
  const match = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
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

/** Fetch a URL and return its HTML text, or an error detail. */
export async function fetchAndParseHtmlPage(url: string): Promise<{ html: string; error?: undefined } | { html?: undefined; error: { url: string; status?: number; message: string } }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)" },
    });
    if (!response.ok) {
      return { error: { url, status: response.status, message: `HTTP ${response.status}: ${response.statusText}` } };
    }
    return { html: await response.text() };
  } catch (err) {
    return { error: { url, message: `Fetch failed: ${err}` } };
  }
}

/** Find the "next page" link in a WordPress paginated page. */
export function findNextPageLink($: CheerioAPI, baseUrl: string): string | null {
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
    return nextHref ? new URL(nextHref, baseUrl).toString() : null;
  }
  return null;
}

/** Article parser callback type. */
export type ArticleParser = ($: CheerioAPI, $article: cheerio.Cheerio<import("domhandler").AnyNode>, baseUrl: string) => RawEventData | null;

/**
 * Shared WordPress blog scraper: fetches paginated articles and parses each one.
 * Used by both ChicagoHashAdapter and ChicagoTH3Adapter.
 */
export async function fetchWordPressBlogEvents(
  source: Source,
  parseArticle: ArticleParser,
  defaultUrl: string,
  maxPages = 3,
): Promise<ScrapeResult> {
  const baseUrl = source.url || defaultUrl;

  const events: RawEventData[] = [];
  const errors: string[] = [];
  const errorDetails: ErrorDetails = {};
  let structureHash: string | undefined;
  let pagesFetched = 0;

  const fetchStart = Date.now();
  let currentUrl: string | null = baseUrl;

  while (currentUrl && pagesFetched < maxPages) {
    const pageResult = await fetchAndParseHtmlPage(currentUrl);

    if (pageResult.error) {
      errors.push(pageResult.error.message);
      errorDetails.fetch = [...(errorDetails.fetch ?? []), pageResult.error];
      if (pagesFetched === 0) return { events: [], errors, errorDetails };
      break;
    }

    if (pagesFetched === 0) {
      structureHash = generateStructureHash(pageResult.html);
    }

    const $ = cheerio.load(pageResult.html);
    pagesFetched++;

    $("article").each((i, el) => {
      try {
        const event = parseArticle($, $(el), baseUrl);
        if (event) {
          events.push(event);
        } else {
          const text = $(el).find(".entry-title, h2").text().trim().slice(0, 80);
          errorDetails.parse = [
            ...(errorDetails.parse ?? []),
            { row: i, section: `page-${pagesFetched}`, error: `Could not parse: ${text}`, rawText: $(el).text().trim().slice(0, 2000) },
          ];
        }
      } catch (err) {
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: i, section: `page-${pagesFetched}`, error: String(err), rawText: $(el).text().trim().slice(0, 2000) },
        ];
      }
    });

    currentUrl = findNextPageLink($, baseUrl);
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
