import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { chronoParseDate, decodeEntities, fetchHTMLPage, googleMapsSearchUrl, isPlaceholder, parse12HourTime, stripHtmlTags } from "../utils";

/**
 * Parse run number and title from a Brass Monkey post title.
 * Format: "Brass Monkey #421 Just Short of A Brass Monkey Mile?"
 */
export function parseBrassMonkeyTitle(title: string): {
  runNumber?: number;
  title?: string;
  date?: string;
} {
  // Extract run number from "Brass Monkey #NNN" or "BMH3 #NNN"
  const match = title.match(/(?:Brass\s+Monkey|BMH3)\s*#(\d+)\s*(.*)/i);
  const runNumber = match ? parseInt(match[1], 10) : undefined;
  const remainder = match ? match[2].trim() : title.trim();

  // Extract numeric date from title: MM/DD/YYYY, MM/DD/YY, or M/D/YYYY
  const dateMatch = remainder.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
  const date = dateMatch ? chronoParseDate(dateMatch[1], "en-US") : undefined;

  // Clean title: only remove date text when it was successfully parsed
  let cleaned = remainder;
  if (dateMatch && date) {
    cleaned = cleaned.replace(dateMatch[0], "").replace(/^[\s:–—-]+|[\s:–—-]+$/g, "").trim();
  }

  return {
    runNumber,
    title: cleaned || undefined,
    date: date ?? undefined,
  };
}

/**
 * Parse structured fields from a Brass Monkey post body.
 *
 * Expected format:
 *   Saturday, March 14, 2026 (3:30 PM start)
 *   Location: 3826 E Mossy Oaks Rd E, Spring 77389
 *   Hare(s): Hash Name
 */
export function parseBrassMonkeyBody(text: string): {
  date?: string;
  startTime?: string;
  location?: string;
  hares?: string;
} {
  // Extract date — only from explicit "Day, Month DD, YYYY" patterns.
  // Do NOT fall back to chronoParseDate(text) as it grabs wrong dates from narrative text.
  const dateMatch = text.match(
    /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(\w+\s+\d{1,2},?\s+\d{4})/i,
  );
  const date = dateMatch ? chronoParseDate(dateMatch[0], "en-US") : undefined;

  // Extract start time from "(3:30 PM start)" or "3:30 PM"
  const startTime = parse12HourTime(text);

  // Label-based extraction
  const locationMatch = text.match(/Location:\s*(.+?)(?=\n|Hare|$)/i);
  const haresMatch = text.match(/Hares?(?:\(s\))?\s*:\s*(.+)$/im);

  return {
    date: date ?? undefined,
    startTime,
    location: locationMatch ? locationMatch[1].trim() : undefined,
    hares: haresMatch ? haresMatch[1].trim() : undefined,
  };
}

/** Process a single Brass Monkey blog post into a RawEventData. */
function processPost(
  titleText: string,
  bodyText: string,
  postUrl: string,
  baseUrl: string,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData | null {
  const titleFields = parseBrassMonkeyTitle(titleText);
  const bodyFields = parseBrassMonkeyBody(bodyText);

  const eventDate = titleFields.date ?? bodyFields.date ?? chronoParseDate(titleText, "en-US");
  if (!eventDate) {
    if (bodyText.trim().length > 0) {
      const dateError = `No date found in post: ${titleText || "(untitled)"}`;
      errors.push(dateError);
      errorDetails.parse = [...(errorDetails.parse ?? []), {
        row: index, section: "post", field: "date",
        error: dateError,
        rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
        partialData: {
          kennelTag: "BMH3",
          title: titleFields.title,
          runNumber: titleFields.runNumber,
          hares: bodyFields.hares,
          location: bodyFields.location,
          sourceUrl: postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`,
        },
      }];
    }
    return null;
  }

  const location = bodyFields.location && !isPlaceholder(bodyFields.location)
    ? bodyFields.location
    : undefined;

  const locationUrl = location ? googleMapsSearchUrl(location) : undefined;

  const sourceUrl = postUrl.startsWith("http") ? postUrl : `${baseUrl.replace(/\/$/, "")}${postUrl}`;

  return {
    date: eventDate,
    kennelTag: "BMH3",
    runNumber: titleFields.runNumber,
    title: titleFields.title,
    hares: bodyFields.hares,
    location,
    locationUrl,
    startTime: bodyFields.startTime,
    sourceUrl,
  };
}

/**
 * Brass Monkey H3 Blogspot Adapter (Houston, TX)
 *
 * Scrapes teambrassmonkey.blogspot.com for trail announcements. Each blog post
 * is one trail (biweekly Saturday cadence). Posts have themed titles with run
 * numbers and structured fields in the body for date, location, and hares.
 *
 * Uses the Blogger API v3 as primary fetch method. Falls back to
 * HTML scraping if the Blogger API is unavailable.
 */
export class BrassMonkeyAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://teambrassmonkey.blogspot.com/";

    // Try Blogger API first
    const apiResult = await this.fetchViaBloggerApi(baseUrl);
    if (apiResult) return apiResult;

    // Fall back to HTML scraping
    return this.fetchViaHtmlScrape(baseUrl);
  }

  private async fetchViaBloggerApi(baseUrl: string): Promise<ScrapeResult | null> {
    const bloggerResult = await fetchBloggerPosts(baseUrl);

    if (bloggerResult.error) {
      return null;
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];
      const bodyText = stripHtmlTags(post.content, "\n");
      const titleText = decodeEntities(post.title);
      const postUrl = post.url;

      const event = processPost(titleText, bodyText, postUrl, baseUrl, i, errors, errorDetails);
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
    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const posts = $(".post-outer, .post, .blog-post").toArray();

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      const titleEl = post.find(".post-title a, .entry-title a, h3.post-title a").first();
      const titleText = titleEl.text().trim() || post.find(".post-title, .entry-title, h3").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      const bodyEl = post.find(".post-body, .entry-content").first();
      const bodyText = bodyEl.text() || "";

      const event = processPost(titleText, bodyText, postUrl, baseUrl, i, errors, errorDetails);
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
