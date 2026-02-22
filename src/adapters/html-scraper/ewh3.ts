import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { fetchWordPressPosts } from "../wordpress-api";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parse a date string like "February 19, 2026" or "Dec 25 2025" or "January 29th, 2026"
 * into YYYY-MM-DD format.
 */
export function parseEwh3Date(text: string): string | null {
  // Match: "February 19, 2026", "January 29th, 2026", "Dec 25 2025"
  const match = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (!match) return null;

  const monthNum = MONTHS[match[1].toLowerCase()];
  if (!monthNum) return null;

  const day = parseInt(match[2], 10);
  const year = parseInt(match[3], 10);

  if (day < 1 || day > 31) return null;

  return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse an EWH3 post title into structured fields.
 *
 * Standard format:
 *   "EWH3 #1506: Huaynaputina's Revenge, February 19, 2026, NoMa/Gallaudet U (Red Line)"
 *
 * Also handles:
 *   "EWH3 #1499.5: Outgoing Misman Trail, January 8th, 2025, Navy Yard/Ballpark (Green)"
 *   "EWH3 Orphan Christmas Trail, Dec 25 2025, Greenbelt (Green Line)"
 */
export function parseEwh3Title(title: string): {
  runNumber?: number;
  trailName?: string;
  date?: string;
  metro?: string;
  metroLines?: string;
} | null {
  // Try standard format: EWH3 #NNNN: Trail Name, Date, Metro (Lines)
  const numbered = title.match(
    /^EWH3\s*#([\d.]+)\s*:\s*(.+?),\s*(\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}),\s*(.+?)(?:\s*[–—-]\s*EWH3)?$/i
  );
  if (numbered) {
    const runNumber = parseFloat(numbered[1]);
    const trailName = numbered[2].trim();
    const date = parseEwh3Date(numbered[3]);
    const metroRaw = numbered[4].trim();

    // Parse metro station and line colors
    const metroMatch = metroRaw.match(/^(.+?)\s*\(([^)]+)\)$/);
    const metro = metroMatch ? metroMatch[1].trim() : metroRaw;
    const metroLines = metroMatch ? metroMatch[2].trim() : undefined;

    return { runNumber: Number.isNaN(runNumber) ? undefined : runNumber, trailName, date: date ?? undefined, metro, metroLines };
  }

  // Try unnumbered format: EWH3 Trail Name, Date, Metro (Lines)
  const unnumbered = title.match(
    /^EWH3\s+(.+?),\s*(\w+\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}),\s*(.+?)(?:\s*[–—-]\s*EWH3)?$/i
  );
  if (unnumbered) {
    const trailName = unnumbered[1].trim();
    const date = parseEwh3Date(unnumbered[2]);
    const metroRaw = unnumbered[3].trim();

    const metroMatch = metroRaw.match(/^(.+?)\s*\(([^)]+)\)$/);
    const metro = metroMatch ? metroMatch[1].trim() : metroRaw;
    const metroLines = metroMatch ? metroMatch[2].trim() : undefined;

    return { trailName, date: date ?? undefined, metro, metroLines };
  }

  return null;
}

/**
 * Parse labeled fields from EWH3 post body text.
 * WordPress Gutenberg text runs together — use label-based delimiters.
 */
export function parseEwh3Body(text: string): {
  hares?: string;
  onAfter?: string;
  endMetro?: string;
} {
  const hareMatch = text.match(/Hares?:\s*(.+?)(?=(?:When|Where|Bring|Nearest|Trail Details|Miscellaneous|End Metro|On\s*After|Last Trains|Give Back):|\n|$)/i);
  const onAfterMatch = text.match(/On[- ]?After\*?:\s*(.+?)(?=\n|$)/i);
  const endMetroMatch = text.match(/End Metro:\s*(.+?)(?=\n|$)/i);

  return {
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
    endMetro: endMetroMatch ? endMetroMatch[1].trim() : undefined,
  };
}

/**
 * Process a single post (from either WordPress API or HTML scrape) into a RawEventData.
 * Returns null if the post cannot be parsed.
 */
function processPost(
  titleText: string,
  bodyText: string,
  postUrl: string,
  baseUrl: string,
): RawEventData | null {
  const parsed = parseEwh3Title(titleText);
  if (!parsed || !parsed.date) return null;

  const location = parsed.metro
    ? parsed.metroLines
      ? `${parsed.metro} (${parsed.metroLines})`
      : parsed.metro
    : undefined;

  const bodyFields = parseEwh3Body(bodyText);

  const descParts: string[] = [];
  if (parsed.trailName) descParts.push(parsed.trailName);
  if (bodyFields.endMetro) descParts.push(`End Metro: ${bodyFields.endMetro}`);
  if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);

  return {
    date: parsed.date,
    kennelTag: "EWH3",
    runNumber: parsed.runNumber ? Math.floor(parsed.runNumber) : undefined,
    title: parsed.trailName,
    hares: bodyFields.hares,
    location,
    startTime: "18:45", // EWH3 always runs at 6:45 PM
    sourceUrl: postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`,
    description: descParts.length > 1 ? descParts.join(" | ") : undefined,
  };
}

/**
 * EWH3 WordPress Trail News Scraper
 *
 * Scrapes ewh3.com for trail announcements. Each WordPress post title contains
 * rich structured data: trail number, trail name, date, metro station, and metro lines.
 * Post body contains additional fields: hares, on-after, end metro.
 *
 * Uses the WordPress REST API as primary fetch method (direct HTML scraping is
 * blocked by cloud IP detection). Falls back to HTML scraping if the API is
 * unavailable.
 */
export class EWH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.ewh3.com/";

    // Try WordPress REST API first
    const apiResult = await this.fetchViaWordPressApi(baseUrl);
    if (apiResult) return apiResult;

    // Fall back to HTML scraping
    return this.fetchViaHtmlScrape(baseUrl);
  }

  private async fetchViaWordPressApi(baseUrl: string): Promise<ScrapeResult | null> {
    const wpResult = await fetchWordPressPosts(baseUrl);

    if (wpResult.error) return null;

    const events: RawEventData[] = [];

    for (const post of wpResult.posts) {
      const $ = cheerio.load(post.content);
      const bodyText = $.text();
      const event = processPost(post.title, bodyText, post.url, baseUrl);
      if (event) events.push(event);
    }

    return {
      events,
      errors: [],
      diagnosticContext: {
        fetchMethod: "wordpress-api",
        postsFound: wpResult.posts.length,
        eventsParsed: events.length,
        fetchDurationMs: wpResult.fetchDurationMs,
      },
    };
  }

  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    let html: string;
    try {
      const response = await fetch(baseUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      if (!response.ok) {
        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [{ url: baseUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      html = await response.text();
    } catch (err) {
      const message = `Fetch failed: ${err}`;
      errorDetails.fetch = [{ url: baseUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    const events: RawEventData[] = [];

    // Find all article post entries on the page
    const articles = $("article.post, article.type-post, article[class*='post-'], .hentry").toArray();

    for (let i = 0; i < articles.length; i++) {
      const article = $(articles[i]);

      const titleEl = article.find(".entry-title a, h2.entry-title a, h2 a, h1.entry-title a").first();
      const titleText = titleEl.text().trim() || article.find(".entry-title, h2").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      if (!titleText) continue;

      const contentEl = article.find(".entry-content, .post-content").first();
      const bodyText = contentEl.text() || "";
      const event = processPost(titleText, bodyText, postUrl, baseUrl);
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        articlesFound: articles.length,
        eventsParsed: events.length,
      },
    };
  }
}
