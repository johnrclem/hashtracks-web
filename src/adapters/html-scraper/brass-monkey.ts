import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { applyDateWindow, chronoParseDate, decodeEntities, fetchHTMLPage, googleMapsSearchUrl, isoDate, isPlaceholder, MONTHS, parse12HourTime, parsePublishDate, stripHtmlTags } from "../utils";

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15,
  sixteenth: 16, seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20,
  "twenty-first": 21, "twenty-second": 22, "twenty-third": 23, "twenty-fourth": 24,
  "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27, "twenty-eighth": 28,
  "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31,
  twentyfirst: 21, twentysecond: 22, twentythird: 23, twentyfourth: 24,
  twentyfifth: 25, twentysixth: 26, twentyseventh: 27, twentyeighth: 28,
  twentyninth: 29, thirtyfirst: 31,
};

const YEAR_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4,
  five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};

// "Saturday, March 14, 2026"
const NUMERIC_DATE_RE = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i;

// "Saturday, March Fourteenth, TwentyTwentySix" — month constrained to real month names
const WORD_DATE_RE = /(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\w[\w-]*),?\s+([\w-]+)/i;

// Year-less "Friday, December 4th" (holiday-party / special-event posts). Only
// used as a last resort, with the year inferred from the post's publish date.
const YEARLESS_DATE_RE = /(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;

const LABELLED_DATE_LINE_RE = /^[^\S\n]*(?:when|date)[^\S\n]*:.*$/im;

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * Parse a year-less "Weekday, Month Dth" date from a post body, picking the
 * year (publish year −1/0/+1) closest to the publish date. A candidate whose
 * weekday matches the stated weekday wins over one that doesn't.
 */
export function parseYearlessBodyDate(text: string, publishDate: Date | undefined): string | undefined {
  if (!publishDate) return undefined;
  // Prefer the event's own "WHEN:"/"Date:" line over an earlier mention
  // ("RSVP by Monday, November 30th … WHEN: Friday, December 4th").
  const labelled = LABELLED_DATE_LINE_RE.exec(text)?.[0];
  const m = (labelled && YEARLESS_DATE_RE.exec(labelled)) || YEARLESS_DATE_RE.exec(text);
  if (!m) return undefined;
  const weekday = WEEKDAYS.indexOf(m[1].toLowerCase());
  const month = MONTHS[m[2].toLowerCase().slice(0, 3)];
  const day = parseInt(m[3], 10);
  const pubY = publishDate.getUTCFullYear();
  let best: { iso: string; score: number } | undefined;
  for (const year of [pubY - 1, pubY, pubY + 1]) {
    const iso = isoDate(year, month, day);
    if (!iso) continue;
    const d = new Date(`${iso}T12:00:00Z`);
    const distance = Math.abs(d.getTime() - publishDate.getTime());
    const score = distance + (d.getUTCDay() === weekday ? 0 : 1e13);
    if (!best || score < best.score) best = { iso, score };
  }
  return best?.iso;
}

/** Convert ordinal word to number: "fourteenth" → 14, "third" → 3 */
function parseOrdinalWord(word: string): number | undefined {
  const normalized = word.toLowerCase().replace(/[-\s]/g, "");
  return ORDINALS[normalized] ?? ORDINALS[word.toLowerCase()];
}

/** Convert spelled-out year to number: "TwentyTwentySix" / "Twenty-Twenty-Six" → 2026 (2020s only) */
function parseWordYear(text: string): number | undefined {
  const normalized = text.toLowerCase().replace(/[-\s]/g, "");
  const match = normalized.match(/^twentytwenty(\w+)$/);
  if (!match) return undefined;
  const unit = YEAR_UNITS[match[1]];
  return unit != null ? 2020 + unit : undefined;
}

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

  // Try numeric pattern first: "Saturday, March 14, 2026"
  const numericDateMatch = text.match(NUMERIC_DATE_RE);
  let date = numericDateMatch ? chronoParseDate(numericDateMatch[0], "en-US") : undefined;

  // Fallback: spelled-out ordinal + word/numeric year — "Saturday, March Fourteenth, TwentyTwentySix"
  if (!date) {
    const wordDateMatch = text.match(WORD_DATE_RE);
    if (wordDateMatch) {
      const [, monthWord, dayWord, yearWord] = wordDateMatch;
      const monthNum = MONTHS[monthWord.toLowerCase().slice(0, 3)];
      const dayNum = parseOrdinalWord(dayWord);
      const yearNum = parseWordYear(yearWord) ?? (/^\d{4}$/.test(yearWord) ? parseInt(yearWord, 10) : undefined);
      if (monthNum && dayNum && yearNum) {
        date = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      }
    }
  }

  // Extract start time from "(3:30 PM start)" or "3:30 PM"
  const startTime = parse12HourTime(text);

  // Label-based extraction
  // "Location: X" anywhere, or a same-line "WHERE: X" (special-event posts;
  // run posts put the venue on the lines after a bare "Where:").
  const locationMatch = text.match(/Location:\s*(.+?)(?=\n|Hare|$)/i)
    ?? text.match(/^\W*Where:[ \t]*(\S.*)$/im);
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
  errorDetails: ErrorDetails,
  publishedIso?: string,
): RawEventData | null {
  const titleFields = parseBrassMonkeyTitle(titleText);
  const bodyFields = parseBrassMonkeyBody(bodyText);

  const eventDate = bodyFields.date
    ?? titleFields.date
    ?? parseYearlessBodyDate(bodyText, parsePublishDate(publishedIso));
  if (!eventDate) {
    // A post without a date (hare sign-up plea, announcement) is skipped and
    // recorded as a parse diagnostic; it only fails the scrape when no post
    // in the batch parsed (see finalizeResult).
    if (bodyText.trim().length > 0) {
      const dateError = `No date found in post: ${titleText || "(untitled)"}`;
      errorDetails.parse = [...(errorDetails.parse ?? []), {
        row: index, section: "post", field: "date",
        error: dateError,
        rawText: `Title: ${titleText}\n\n${bodyText}`.slice(0, 2000),
        partialData: {
          kennelTags: ["bmh3-tx"],
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
    kennelTags: ["bmh3-tx"],
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
 * Build the ScrapeResult for a batch of posts. Undated posts stay in
 * `errorDetails.parse` (diagnostics + AI recovery) without failing the scrape,
 * unless posts were found and none produced an event, which points at a
 * format change rather than one stray post.
 */
function finalizeResult(
  events: RawEventData[],
  errorDetails: ErrorDetails,
  postsFound: number,
): Pick<ScrapeResult, "events" | "errors" | "errorDetails"> & { skippedPosts: string[] } {
  const skippedPosts = (errorDetails.parse ?? []).map((e) => e.error);
  let errors: string[] = [];
  if (postsFound > 0 && events.length === 0) {
    errors = skippedPosts.length > 0
      ? skippedPosts
      : [`${postsFound} post(s) found but none produced an event`];
  }
  return {
    events,
    errors,
    errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
    skippedPosts,
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
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://teambrassmonkey.blogspot.com/";

    // Honor source.scrapeDays via options.days (default 365)
    const days = options?.days ?? source.scrapeDays ?? 365;

    // Try Blogger API first
    const apiResult = await this.fetchViaBloggerApi(baseUrl);
    if (apiResult) return applyDateWindow(apiResult, days);

    // Fall back to HTML scraping
    const htmlResult = await this.fetchViaHtmlScrape(baseUrl);
    return applyDateWindow(htmlResult, days);
  }

  private async fetchViaBloggerApi(baseUrl: string): Promise<ScrapeResult | null> {
    const bloggerResult = await fetchBloggerPosts(baseUrl);

    if (bloggerResult.error) {
      return null;
    }

    const events: RawEventData[] = [];
    const errorDetails: ErrorDetails = {};

    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];
      const bodyText = stripHtmlTags(post.content, "\n");
      const titleText = decodeEntities(post.title);
      const postUrl = post.url;

      const event = processPost(titleText, bodyText, postUrl, baseUrl, i, errorDetails, post.published);
      if (event) events.push(event);
    }

    const { skippedPosts, ...result } = finalizeResult(events, errorDetails, bloggerResult.posts.length);

    return {
      ...result,
      diagnosticContext: {
        fetchMethod: "blogger-api",
        blogId: bloggerResult.blogId,
        postsFound: bloggerResult.posts.length,
        eventsParsed: events.length,
        skippedPosts,
        fetchDurationMs: bloggerResult.fetchDurationMs,
      },
    };
  }

  private async fetchViaHtmlScrape(baseUrl: string): Promise<ScrapeResult> {
    const page = await fetchHTMLPage(baseUrl);
    if (!page.ok) return page.result;

    const { $, structureHash, fetchDurationMs } = page;
    const events: RawEventData[] = [];
    const errorDetails: ErrorDetails = {};

    const posts = $(".post-outer, .post, .blog-post").toArray();

    for (let i = 0; i < posts.length; i++) {
      const post = $(posts[i]);

      const titleEl = post.find(".post-title a, .entry-title a, h3.post-title a").first();
      const titleText = titleEl.text().trim() || post.find(".post-title, .entry-title, h3").first().text().trim();
      const postUrl = titleEl.attr("href") || baseUrl;

      const bodyEl = post.find(".post-body, .entry-content").first();
      const bodyText = bodyEl.text() || "";

      const published = post.find("abbr.published, time.published, .published").first().attr("title")
        ?? post.find("time[datetime]").first().attr("datetime");
      const event = processPost(titleText, bodyText, postUrl, baseUrl, i, errorDetails, published);
      if (event) events.push(event);
    }

    const { skippedPosts, ...result } = finalizeResult(events, errorDetails, posts.length);

    return {
      ...result,
      structureHash,
      diagnosticContext: {
        fetchMethod: "html-scrape",
        postsFound: posts.length,
        eventsParsed: events.length,
        skippedPosts,
        fetchDurationMs,
      },
    };
  }
}
