import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { chronoParseDate, parse12HourTime, decodeEntities, isPlaceholder } from "../utils";

/** WordPress.com REST API post shape (subset of fields we request). */
interface WpComPost {
  ID: number;
  date: string;
  title: string;
  URL: string;
  content: string;
}

/** Labels used as section delimiters in post body HTML. */
const LABEL_PATTERNS: Record<string, RegExp> = {
  when: /^when$/i,
  where: /^where$/i,
  hares: /^who\s*[–\-]\s*hares[:\s]*$/i,
  notes: /^notes[:\s]*$/i,
  onAfter: /^on[- ]?after[:\s]*$/i,
  dogFriendly: /^dog\s+friendly\??$/i,
};

/**
 * Find the next <p> sibling(s) after the <p> containing a <strong> with the
 * given label. Returns the text content and optional href of the first link.
 */
function extractFieldAfterLabel(
  $: CheerioAPI,
  labelRegex: RegExp,
): { text: string; href?: string } | null {
  const strongs = $("strong").toArray();
  for (const el of strongs) {
    const strongText = $(el).text().trim();
    if (!labelRegex.test(strongText)) continue;

    // The label's <p>, then find the next <p> sibling
    const labelP = $(el).closest("p");
    const nextP = labelP.nextAll("p").first();
    if (!nextP.length) return null;

    const text = decodeEntities(nextP.text().trim());
    const link = nextP.find("a").first();
    const href = link.length ? link.attr("href") : undefined;

    return { text, href };
  }
  return null;
}

/**
 * Parse a single Cape Fear H3 blog post body into partial RawEventData.
 * Uses the post's publish date year as chrono-node reference to resolve
 * year-less dates like "Saturday, March 21st" correctly.
 *
 * Exported for unit testing.
 */
export function parseCfh3Post(
  $: CheerioAPI,
  publishDateIso: string,
): Omit<RawEventData, "sourceUrl"> | null {
  // Extract When field — required
  const whenField = extractFieldAfterLabel($, LABEL_PATTERNS.when);
  if (!whenField) return null;

  // Use publish date's year as reference for chrono parsing
  const publishYear = new Date(publishDateIso).getFullYear();
  const refDate = new Date(Date.UTC(publishYear, 0, 1, 12));
  const date = chronoParseDate(whenField.text, "en-US", refDate);
  if (!date) return null;

  // Extract start time — normalize "p.m."→"pm" since parse12HourTime only handles "am/pm"
  const normalizedWhen = whenField.text.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm");
  const startTime = parse12HourTime(normalizedWhen);

  // Extract other fields
  const whereField = extractFieldAfterLabel($, LABEL_PATTERNS.where);
  const haresField = extractFieldAfterLabel($, LABEL_PATTERNS.hares);
  const notesField = extractFieldAfterLabel($, LABEL_PATTERNS.notes);
  const onAfterField = extractFieldAfterLabel($, LABEL_PATTERNS.onAfter);
  const dogField = extractFieldAfterLabel($, LABEL_PATTERNS.dogFriendly);

  // Build location
  const location = whereField?.text || undefined;
  const locationUrl = whereField?.href?.startsWith("http") ? whereField.href : undefined;

  // Build description from optional fields
  const descParts: string[] = [];
  if (notesField?.text) descParts.push(notesField.text);
  if (dogField?.text) descParts.push(`Dog Friendly: ${dogField.text}`);
  if (onAfterField?.text && !isPlaceholder(onAfterField.text)) {
    descParts.push(`On After: ${onAfterField.text}`);
  }

  return {
    date,
    kennelTag: "cfh3",
    hares: haresField?.text || undefined,
    location,
    locationUrl,
    startTime,
    description: descParts.length > 0 ? descParts.join(" | ") : undefined,
  };
}

/**
 * Cape Fear H3 WordPress.com Blog Scraper
 *
 * Fetches trail announcements from the WordPress.com public REST API.
 * Each blog post is one trail, with structured fields (When, Where, Hares)
 * parsed from the post body HTML.
 *
 * The API provides ISO 8601 publish dates with years, which serve as
 * reference dates for resolving year-less event dates in the post body.
 */
export class CapeFearH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const apiUrl =
      "https://public-api.wordpress.com/rest/v1.1/sites/capefearh3.com/posts/" +
      "?number=5&fields=ID,date,title,URL,slug,content,categories";

    const fetchStart = Date.now();
    let posts: WpComPost[];
    try {
      const response = await safeFetch(apiUrl, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const message = `WordPress.com API HTTP ${response.status}`;
        errorDetails.fetch = [{ url: apiUrl, status: response.status, message }];
        return { events: [], errors: [message], errorDetails };
      }
      const data = (await response.json()) as { posts?: WpComPost[] };
      posts = data.posts ?? [];
    } catch (err) {
      const message = `WordPress.com API fetch failed: ${err}`;
      errorDetails.fetch = [{ url: apiUrl, message }];
      return { events: [], errors: [message], errorDetails };
    }
    const fetchDurationMs = Date.now() - fetchStart;

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      const $ = cheerio.load(post.content);
      const titleText = decodeEntities(post.title);

      const parsed = parseCfh3Post($, post.date);
      if (!parsed) {
        // Non-trail posts (no When field) are silently skipped
        continue;
      }

      events.push({
        ...parsed,
        title: titleText || undefined,
        sourceUrl: post.URL,
      });
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "wordpress-com-api",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
