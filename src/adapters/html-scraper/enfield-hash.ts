import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { fetchBloggerPosts } from "../blogger-api";
import { buildUrlVariantCandidates, decodeEntities } from "../utils";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
  apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

/**
 * Parse a date from Enfield Hash blog post text.
 * Formats:
 *   "Wednesday 18th March 2026" → "2026-03-18"
 *   "18th March 2026" → "2026-03-18"
 *   "March 18, 2026" → "2026-03-18"
 *   "18/03/2026" → "2026-03-18"
 */
export function parseEnfieldDate(text: string): string | null {
  // Try DD/MM/YYYY format first
  const numericMatch = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    const year = parseInt(numericMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try UK format: "DDth Month YYYY" (e.g., "18th March 2026")
  const ukMatch = text.match(
    /(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+(\w+)\s+(\d{4})/i,
  );
  if (ukMatch) {
    const day = parseInt(ukMatch[1], 10);
    const monthNum = MONTHS[ukMatch[2].toLowerCase()];
    const year = parseInt(ukMatch[3], 10);
    if (monthNum && day >= 1 && day <= 31) {
      return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try US format: "Month DD, YYYY" (e.g., "March 18, 2026")
  const usMatch = text.match(/(\w+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
  if (usMatch) {
    const monthNum = MONTHS[usMatch[1].toLowerCase()];
    if (monthNum) {
      const day = parseInt(usMatch[2], 10);
      const year = parseInt(usMatch[3], 10);
      if (day >= 1 && day <= 31) {
        return `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
    }
  }

  return null;
}

/**
 * Parse labeled fields from an Enfield Hash blog post body.
 *
 * Expected patterns in blog posts:
 *   "Date: Wednesday 18th March 2026"
 *   "Pub: The King's Head"
 *   "Station: Enfield Chase"
 *   "Hare: Name"
 *   "Start: 7:30pm"
 *
 * Also handles unlabeled text where date/pub/station appear in prose.
 */
export function parseEnfieldBody(text: string): {
  date?: string;
  hares?: string;
  location?: string;
  station?: string;
} {
  // Stop pattern: only match label words when followed by a colon (i.e., the start
  // of a new labeled field), not bare words inside values like "The Station Hotel"
  const labelBoundary = "(?:Date|When|Pub|Where|Location|Station|Hares?|Start|Time|Meet)\\s*:";
  const stopPattern = `(?=${labelBoundary}|\\n|$)`;

  // Date from "Date:" or "When:" label
  const dateMatch = text.match(new RegExp(`(?:Date|When):\\s*(.+?)${stopPattern}`, "i"));
  const date = dateMatch ? parseEnfieldDate(dateMatch[1].trim()) : parseEnfieldDate(text);

  // Hare from "Hare:" or "Hares:" label
  const hareMatch = text.match(new RegExp(`Hares?:\\s*(.+?)${stopPattern}`, "i"));
  let hares: string | undefined;
  if (hareMatch) {
    const haresText = hareMatch[1].trim();
    if (!/tba|tbd|tbc|needed|required/i.test(haresText)) {
      hares = haresText;
    }
  }

  // Location from "Pub:" or "Where:" or "Location:" label
  const pubMatch = text.match(new RegExp(`(?:Pub|Where|Location|Venue):\\s*(.+?)${stopPattern}`, "i"));
  const location = pubMatch ? pubMatch[1].trim() : undefined;

  // Station from "Station:" label
  const stationMatch = text.match(new RegExp(`Station:\\s*(.+?)${stopPattern}`, "i"));
  const station = stationMatch ? stationMatch[1].trim() : undefined;

  return {
    date: date ?? undefined,
    hares,
    location: location && !/^tba|^tbd|^tbc/i.test(location) ? location : undefined,
    station: station && !/^tba|^tbd|^tbc/i.test(station) ? station : undefined,
  };
}


/**
 * Process a single blog post (from either Blogger API or HTML scrape) into a RawEventData.
 * Returns null if the post cannot be parsed (e.g., missing date).
 */
function processPost(
  titleText: string,
  bodyText: string,
  postUrl: string,
  baseUrl: string,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData | null {
  const bodyFields = parseEnfieldBody(bodyText);

  if (!bodyFields.date) {
    const titleDate = parseEnfieldDate(titleText);
    if (!titleDate) {
      if (bodyText.trim().length > 0) {
        errors.push(
          `Could not parse date from post: ${titleText || "(untitled)"}`,
        );
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: index,
            section: "post",
            field: "date",
            error: `No date found in post: ${titleText || "(untitled)"}`,
            rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
            partialData: { kennelTag: "EH3", title: titleText || undefined },
          },
        ];
      }
      return null;
    }
    bodyFields.date = titleDate;
  }

  const descParts: string[] = [];
  if (bodyFields.station) {
    descParts.push(`Nearest station: ${bodyFields.station}`);
  }
  const description =
    descParts.length > 0 ? descParts.join(". ") : undefined;

  const sourceUrl = postUrl.startsWith("http")
    ? postUrl
    : `${baseUrl.replace(/\/$/, "")}${postUrl}`;

  return {
    date: bodyFields.date,
    kennelTag: "EH3",
    title: titleText || undefined,
    hares: bodyFields.hares,
    location: bodyFields.location,
    startTime: "19:30", // EH3: always 3rd Wednesday 7:30 PM
    sourceUrl,
    description,
  };
}

/**
 * Enfield Hash House Harriers (EH3) Blogspot Scraper
 *
 * Scrapes enfieldhash.org (Blogger/Blogspot) for run announcements.
 * Each blog post announces the next run with date, pub name, station,
 * and directions. Monthly kennel (3rd Wednesday, 7:30 PM).
 *
 * Uses the Blogger API v3 as primary fetch method (direct HTML scraping
 * is blocked by Google's bot detection on cloud IPs). Falls back to
 * HTML scraping if the Blogger API is unavailable.
 */
export class EnfieldHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "http://www.enfieldhash.org/";

    // Try Blogger API first
    const { result: apiResult, apiError } = await this.fetchViaBloggerApi(baseUrl);
    if (apiResult) return apiResult;

    // Fall back to HTML scraping (pass API error for diagnostics if both paths fail)
    return this.fetchViaHtmlScrape(baseUrl, apiError);
  }

  private async fetchViaBloggerApi(baseUrl: string): Promise<{
    result: ScrapeResult | null;
    apiError?: string;
  }> {
    const bloggerResult = await fetchBloggerPosts(baseUrl);

    // If the Blogger API errored (missing key, API not enabled, etc.), return null to trigger fallback
    if (bloggerResult.error) {
      return { result: null, apiError: bloggerResult.error.message };
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];

      // Extract text from HTML content
      const $ = cheerio.load(post.content);
      const bodyText = $.text();
      const titleText = decodeEntities(post.title);
      const postUrl = post.url;

      const event = processPost(
        titleText,
        bodyText,
        postUrl,
        baseUrl,
        i,
        errors,
        errorDetails,
      );
      if (event) events.push(event);
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      result: {
        events,
        errors,
        errorDetails: hasErrorDetails ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "blogger-api",
          blogId: bloggerResult.blogId,
          postsFound: bloggerResult.posts.length,
          eventsParsed: events.length,
          fetchDurationMs: bloggerResult.fetchDurationMs,
        },
      },
    };
  }

  private async fetchViaHtmlScrape(baseUrl: string, bloggerApiError?: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const requestHeaders = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };

    let html: string | undefined;
    let fetchUrl = baseUrl;
    const fetchStart = Date.now();
    const candidateUrls = buildUrlVariantCandidates(baseUrl);

    for (const candidateUrl of candidateUrls) {
      try {
        const response = await fetch(candidateUrl, {
          headers: requestHeaders,
        });

        if (response.ok) {
          html = await response.text();
          fetchUrl = candidateUrl;
          break;
        }

        const message = `HTTP ${response.status}: ${response.statusText}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, status: response.status, message },
        ];

        if (response.status !== 403 && response.status !== 404) {
          return {
            events: [],
            errors: [message],
            errorDetails,
            diagnosticContext: {
              fetchMethod: "html-scrape",
              ...(bloggerApiError ? { bloggerApiError } : {}),
            },
          };
        }
      } catch (err) {
        const message = `Fetch failed: ${err}`;
        errorDetails.fetch = [
          ...(errorDetails.fetch ?? []),
          { url: candidateUrl, message },
        ];
      }
    }

    if (!html) {
      const last = errorDetails.fetch?.[errorDetails.fetch.length - 1];
      const fallbackMessage = last?.message ?? "Fetch failed";
      return {
        events: [],
        errors: [fallbackMessage],
        errorDetails,
        diagnosticContext: {
          fetchMethod: "html-scrape",
          ...(bloggerApiError ? { bloggerApiError } : {}),
        },
      };
    }

    const fetchDurationMs = Date.now() - fetchStart;

    const structureHash = generateStructureHash(html);
    const $ = cheerio.load(html);

    // Blogger uses nested .post-outer > .post — prefer outermost to avoid double-counting
    let posts = $(".post-outer").toArray();
    if (posts.length === 0) {
      posts = $(".post, .blog-post").toArray();
    }

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      const titleEl = post
        .find(".post-title a, .entry-title a, h3.post-title a")
        .first();
      const titleText =
        titleEl.text().trim() ||
        post.find(".post-title, .entry-title, h3").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      const bodyEl = post.find(".post-body, .entry-content").first();
      const bodyText = bodyEl.text() || "";

      const event = processPost(
        titleText,
        bodyText,
        postUrl,
        fetchUrl,
        i,
        errors,
        errorDetails,
      );
      if (event) events.push(event);
    }

    const hasErrorDetails =
      (errorDetails.fetch?.length ?? 0) > 0 ||
      (errorDetails.parse?.length ?? 0) > 0;

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
        ...(bloggerApiError ? { bloggerApiError } : {}),
      },
    };
  }
}
