import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressComPosts, type WordPressComPage } from "../wordpress-api";
import { applyDateWindow, chronoParseDate, parse12HourTime, decodeEntities, isPlaceholder, googleMapsSearchUrl } from "../utils";

const SITE_DOMAIN = "n2th3.org";
const KENNEL_TAG = "n2th3";
const DEFAULT_START_TIME = "19:00";

/**
 * Extract a labeled field value from post body HTML.
 * Looks for `<strong>Label:</strong> Value` patterns in `<p>` elements.
 * Returns the text after the label, trimmed.
 */
function extractLabeledField($: cheerio.CheerioAPI, label: RegExp): { text: string; href?: string } | null {
  const paragraphs = $("p").toArray();
  for (const p of paragraphs) {
    const $p = $(p);
    const strong = $p.find("strong").first();
    if (!strong.length) continue;

    const strongText = strong.text().trim().replace(/:?\s*$/, "");
    if (!label.test(strongText)) continue;

    // Get text after the strong tag — could be in same <p> or the strong itself
    // Clone the paragraph, remove the strong, get remaining text
    const fullText = $p.text().trim();
    const labelText = strong.text().trim();
    const afterLabel = fullText.slice(fullText.indexOf(labelText) + labelText.length).replace(/^[:\s]+/, "").trim();

    if (!afterLabel) continue;

    // Check for a link in the same paragraph
    const link = $p.find("a").first();
    const href = link.length ? link.attr("href") : undefined;

    return { text: afterLabel, href };
  }
  return null;
}

/**
 * Parse run number from title like "Run announcement 2226 – 9 April – Cornwall Street Park"
 * or "Birthday run announcement 2220 – 26 February – Kowloon Tong"
 */
function parseRunNumber(title: string): number | undefined {
  const match = /(?:run\s+)?announcement\s+(\d{3,5})/i.exec(title);
  if (match) return parseInt(match[1], 10);

  // Fallback: any standalone 4-digit number
  const fallback = /\b(\d{4})\b/.exec(title);
  return fallback ? parseInt(fallback[1], 10) : undefined;
}

/**
 * Parse a single N2TH3 WordPress.com blog post into RawEventData.
 * Tries body fields first (richer data), falls back to title parsing.
 *
 * Exported for unit testing.
 */
export function parseN2th3Post(
  post: WordPressComPage,
): RawEventData | null {
  const title = decodeEntities(post.title);

  // Skip non-trail posts (e.g., AGM announcements, social posts)
  if (!/announcement/i.test(title) && !/\brun\b/i.test(title)) return null;

  const $ = cheerio.load(post.content);

  // Extract body fields
  const dateField = extractLabeledField($, /^date$/i);
  const timeField = extractLabeledField($, /^time$/i);
  const locationField = extractLabeledField($, /^location$/i);
  const mapField = extractLabeledField($, /^map$/i);
  const hareField = extractLabeledField($, /^hares?$/i);
  const descField = extractLabeledField($, /^hare\s+says$/i);

  // Parse date — try body date field first, then title
  // Use the actual post publish date as chrono reference so year-less dates
  // around New Year resolve correctly (e.g., Dec post about Jan run).
  const refDate = new Date(post.date);
  let date: string | null = null;

  if (dateField?.text) {
    date = chronoParseDate(dateField.text, "en-GB", refDate);
  }
  if (!date) {
    // Try title: "Run announcement 2226 – 9 April – Cornwall Street Park"
    date = chronoParseDate(title, "en-GB", refDate);
  }
  if (!date) return null;

  // Parse time
  let startTime = DEFAULT_START_TIME;
  if (timeField?.text) {
    const parsed = parse12HourTime(timeField.text.replace(/\./g, ""));
    if (parsed) startTime = parsed;
  }

  // Parse run number from title
  const runNumber = parseRunNumber(title);

  // Location and map URL
  const location = locationField?.text || undefined;
  let locationUrl: string | undefined;
  if (mapField?.href) {
    locationUrl = mapField.href;
  } else if (mapField?.text && /^https?:\/\//.test(mapField.text)) {
    locationUrl = mapField.text;
  } else if (location) {
    locationUrl = googleMapsSearchUrl(location);
  }

  // Hares
  const hares = hareField?.text && !isPlaceholder(hareField.text) ? hareField.text : undefined;

  // Description
  const description = descField?.text || undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    title: runNumber ? `N2TH3 Run #${runNumber}` : title,
    hares,
    location,
    locationUrl,
    startTime,
    description,
    sourceUrl: post.URL,
  };
}

/**
 * N2TH3 (Northern New Territories Hash House Harriers) WordPress.com Adapter
 *
 * Scrapes n2th3.org trail announcements via the WordPress.com Public REST API.
 * Each blog post is a run announcement with structured fields in the body:
 * Hare, Time, Date, Location, Map URL, and "Hare says" description.
 *
 * Post titles follow: "Run announcement NNNN – Date – Location"
 */
export class N2TH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const fetchStart = Date.now();

    const { posts, found, error, fetchDurationMs: _apiFetchMs } = await fetchWordPressComPosts(
      SITE_DOMAIN,
      { number: 20 },
    );

    if (error) {
      const errorDetails: ErrorDetails = {
        fetch: [{ url: `public-api.wordpress.com/.../sites/${SITE_DOMAIN}/posts/`, message: error.message, status: error.status }],
      };
      return { events: [], errors: [error.message], errorDetails };
    }

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    for (const post of posts) {
      try {
        const event = parseN2th3Post(post);
        if (event) {
          events.push(event);
        }
      } catch (err) {
        errors.push(`Error parsing post "${post.title}": ${err}`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          { row: post.ID, error: String(err), rawText: post.title.slice(0, 200) },
        ];
      }
    }

    const fetchDurationMs = Date.now() - fetchStart;

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "wordpress-com-api",
          postsFound: found,
          postsFetched: posts.length,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
