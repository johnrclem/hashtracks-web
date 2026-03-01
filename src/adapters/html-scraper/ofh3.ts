import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { generateStructureHash } from "@/pipeline/structure-hash";
import { fetchBloggerPosts } from "../blogger-api";
import { chronoParseDate, decodeEntities } from "../utils";

/**
 * Parse a date string from OFH3 content.
 * Handles: "Saturday, March 14, 2026", "March 14th, 2026", "3.14.26" (M.DD.YY)
 *
 * Tries dot-separated format first (specific to OFH3) to avoid chrono picking
 * up a stray month name before the dot-separated date in title text.
 */
export function parseOfh3Date(text: string): string | null {
  // Try dot-separated format first: "3.14.26" or "03.14.2026"
  const dotMatch = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (dotMatch) {
    const month = parseInt(dotMatch[1], 10);
    const day = parseInt(dotMatch[2], 10);
    let year = parseInt(dotMatch[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  // Fall back to chrono-node for standard date formats
  return chronoParseDate(text, "en-US");
}

/**
 * Parse labeled fields from an OFH3 post body.
 *
 * Expected fields (bold labels followed by text):
 *   Hares: Name & Name
 *   When: Saturday, March 14, 2026
 *   Cost: $5, virgins free
 *   Where: Blue Heron Elementary School
 *   Trail Type: A-A
 *   Distances: 3ish
 *   Shiggy rating (1-10): 5
 *   On-After: Venue Name
 */
export function parseOfh3Body(text: string): {
  date?: string;
  hares?: string;
  cost?: string;
  location?: string;
  trailType?: string;
  distances?: string;
  shiggyRating?: string;
  onAfter?: string;
} {
  // Use label-based extraction, stopping at the next known label or newline
  const labels = "(?:Hares?|When|Time|Cost|Where|Trail Type|Distances?|Shiggy|On[- ]?After)";
  const stopPattern = `(?=${labels}|\\n|$)`;

  const whenMatch = text.match(new RegExp(`When:\\s*(.+?)${stopPattern}`, "i"));
  const hareMatch = text.match(new RegExp(`Hares?:\\s*(.+?)${stopPattern}`, "i"));
  const costMatch = text.match(new RegExp(`Cost:\\s*(.+?)${stopPattern}`, "i"));
  const whereMatch = text.match(new RegExp(`Where:\\s*(.+?)${stopPattern}`, "i"));
  const trailTypeMatch = text.match(new RegExp(`Trail Type:\\s*(.+?)${stopPattern}`, "i"));
  const distancesMatch = text.match(new RegExp(`Distances?:\\s*(.+?)${stopPattern}`, "i"));
  const shiggyMatch = text.match(/Shiggy\s*(?:rating)?\s*(?:\(1-10\))?\s*:\s*(.+?)(?=(?:Hares?|When|Cost|Where|Trail Type|Distances?|On[- ]?After)|\n|$)/i);
  const onAfterMatch = text.match(new RegExp(`On[- ]?After:\\s*(.+?)${stopPattern}`, "i"));

  const date = whenMatch ? parseOfh3Date(whenMatch[1].trim()) : undefined;

  return {
    date: date ?? undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    cost: costMatch ? costMatch[1].trim() : undefined,
    location: whereMatch ? whereMatch[1].trim() : undefined,
    trailType: trailTypeMatch ? trailTypeMatch[1].trim() : undefined,
    distances: distancesMatch ? distancesMatch[1].trim() : undefined,
    shiggyRating: shiggyMatch ? shiggyMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
  };
}

/**
 * Process a single OFH3 blog post into a RawEventData.
 * Returns null if the post cannot be parsed (e.g., missing date).
 */
/** Resolve the event date from body fields or title text. Returns null if unresolvable. */
function resolveOfh3EventDate(
  bodyFields: ReturnType<typeof parseOfh3Body>,
  titleText: string,
): string | null {
  if (bodyFields.date) return bodyFields.date;
  return parseOfh3Date(titleText);
}

/** Build a description string from OFH3 body fields. */
function buildOfh3Description(bodyFields: ReturnType<typeof parseOfh3Body>): string | undefined {
  const descParts: string[] = [];
  if (bodyFields.trailType) descParts.push(`Trail Type: ${bodyFields.trailType}`);
  if (bodyFields.distances) descParts.push(`Distances: ${bodyFields.distances}`);
  if (bodyFields.shiggyRating) descParts.push(`Shiggy: ${bodyFields.shiggyRating}`);
  if (bodyFields.cost) descParts.push(`Cost: ${bodyFields.cost}`);
  if (bodyFields.onAfter) descParts.push(`On After: ${bodyFields.onAfter}`);
  return descParts.length > 0 ? descParts.join(" | ") : undefined;
}

function processPost(
  titleText: string,
  bodyText: string,
  postUrl: string,
  baseUrl: string,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData | null {
  const bodyFields = parseOfh3Body(bodyText);

  const eventDate = resolveOfh3EventDate(bodyFields, titleText);
  if (!eventDate) {
    if (bodyText.trim().length > 0) {
      const dateError = `No date found in post: ${titleText || "(untitled)"}`;
      errors.push(dateError);
      errorDetails.parse = [...(errorDetails.parse ?? []), {
        row: index, section: "post", field: "date",
        error: dateError,
        rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
        partialData: {
          kennelTag: "OFH3",
          title: titleText || undefined,
          hares: bodyFields.hares,
          location: bodyFields.location,
          sourceUrl: postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`,
        },
      }];
    }
    return null;
  }

  let locationUrl: string | undefined;
  if (bodyFields.location && bodyFields.location.toLowerCase() !== "tba") {
    locationUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bodyFields.location)}`;
  }

  const sourceUrl = postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`;

  return {
    date: eventDate,
    kennelTag: "OFH3",
    title: titleText || undefined,
    hares: bodyFields.hares,
    location: bodyFields.location && bodyFields.location.toLowerCase() !== "tba" ? bodyFields.location : undefined,
    locationUrl,
    startTime: "11:00",
    sourceUrl,
    description: buildOfh3Description(bodyFields),
  };
}

/**
 * OFH3 Blogspot Trail Posts Scraper
 *
 * Scrapes ofh3.com (Blogger/Blogspot) for trail announcements. Each blog post
 * is one trail (monthly cadence). Posts have themed titles and structured
 * labeled fields in the body for hares, date, cost, location, trail type,
 * distances, shiggy rating, and on-after.
 *
 * Uses the Blogger API v3 as primary fetch method (direct HTML scraping
 * is blocked by Google's bot detection on cloud IPs). Falls back to
 * HTML scraping if the Blogger API is unavailable.
 */
export class OFH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.ofh3.com/";

    // Try Blogger API first
    const apiResult = await this.fetchViaBloggerApi(baseUrl);
    if (apiResult) return apiResult;

    // Fall back to HTML scraping
    return this.fetchViaHtmlScrape(baseUrl);
  }

  private async fetchViaBloggerApi(baseUrl: string): Promise<ScrapeResult | null> {
    const bloggerResult = await fetchBloggerPosts(baseUrl);

    // If the Blogger API errored (missing key, API not enabled, etc.), return null to trigger fallback
    if (bloggerResult.error) {
      return null;
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

    const hasErrorDetails = hasAnyErrors(errorDetails);

    return {
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
    };
  }

  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
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

    // Blogger uses .post-outer or .post for each blog post
    const posts = $(".post-outer, .post, .blog-post").toArray();

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      const titleEl = post.find(".post-title a, .entry-title a, h3.post-title a").first();
      const titleText = titleEl.text().trim() || post.find(".post-title, .entry-title, h3").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      const bodyEl = post.find(".post-body, .entry-content").first();
      const bodyText = bodyEl.text() || "";

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

    return {
      events,
      errors,
      structureHash,
      errorDetails: (errorDetails.fetch?.length ?? 0) > 0 || (errorDetails.parse?.length ?? 0) > 0 ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
      },
    };
  }
}
