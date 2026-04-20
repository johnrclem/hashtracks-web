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
 *
 * N2TH3 posts often collapse multiple labels into a single `<p>` separated
 * by `<br>`, e.g.:
 *   <p><strong>Hares:</strong><br>Golden Balls
 *      <br><br><strong>Location:</strong><br>Fanling Recreation Ground</p>
 *
 * Walking `<p>.text()` after the first `<strong>` leaks the next label's
 * value into this one. Instead, iterate `<strong>` tags and collect sibling
 * nodes *until the next `<strong>`* so each label gets exactly its own value.
 */
/**
 * Walk sibling nodes after `startNode` until the next `<strong>` tag,
 * accumulating text content and the first `<a>` href found (direct or nested).
 */
function collectSiblingValue(
  $: cheerio.CheerioAPI,
  startNode: { nextSibling: unknown },
): { text: string; href?: string } {
  let text = "";
  let href: string | undefined;
  let node = startNode.nextSibling as { type?: string; nextSibling: unknown; name?: string; data?: string } | null;
  while (node) {
    if (node.type === "tag") {
      if (node.name === "strong") break;
      if (node.name === "br") {
        // `<br>` has empty .text(); add an explicit space so adjacent values
        // don't concatenate (e.g. line-break between location and map URL).
        text += " ";
      } else {
        if (!href) {
          const directHref = node.name === "a" ? $(node as never).attr("href") : undefined;
          href = directHref || $(node as never).find("a").first().attr("href") || undefined;
        }
        text += $(node as never).text();
      }
    } else if (node.type === "text") {
      text += node.data ?? "";
    }
    node = node.nextSibling as typeof node;
  }
  return { text, href };
}

function extractLabeledField(
  $: cheerio.CheerioAPI,
  label: RegExp,
): { text: string; href?: string } | null {
  const strongs = $("p strong").toArray();
  for (const strong of strongs) {
    const strongText = $(strong).text().trim().replace(/:?\s*$/, "");
    if (!label.test(strongText)) continue;

    const { text, href } = collectSiblingValue($, strong);
    const trimmed = text.replace(/^[:\s]+/, "").replaceAll(/\s+/g, " ").trim();
    // Return href-only fields too: an icon/image-only map link has empty
    // visible text but a valid href we want to preserve.
    if (trimmed || href) return { text: trimmed, href };
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
 * Body `Location:` field, with a title fallback: "[Birthday] [Run] announcement
 * <N> – <date> – <location>". Later segments (e.g. "bring torch") are
 * descriptive noise — only the third segment is the venue.
 */
function resolveN2th3Location(
  title: string,
  locationField: { text: string } | null,
): string | undefined {
  if (locationField?.text) return locationField.text;
  const segments = title.split(/\s+[–—-]\s+/).map(s => s.trim()).filter(Boolean);
  if (segments.length >= 3 && /announcement/i.test(segments[0])) {
    return segments[2];
  }
  return undefined;
}

function resolveN2th3MapUrl(
  mapField: { text: string; href?: string } | null,
  location: string | undefined,
): string | undefined {
  if (mapField?.href) return mapField.href;
  if (mapField?.text && /^https?:\/\//.test(mapField.text)) return mapField.text;
  return location ? googleMapsSearchUrl(location) : undefined;
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
  const dateField = extractLabeledField($, /^date$/i);
  const timeField = extractLabeledField($, /^time$/i);
  const locationField = extractLabeledField($, /^location$/i);
  const mapField = extractLabeledField($, /^map$/i);
  const hareField = extractLabeledField($, /^hares?$/i);
  const descField = extractLabeledField($, /^hare\s+says$/i);

  // Use the actual post publish date as chrono reference so year-less dates
  // around New Year resolve correctly (e.g., Dec post about Jan run).
  const refDate = new Date(post.date);
  const date =
    (dateField?.text && chronoParseDate(dateField.text, "en-GB", refDate)) ||
    chronoParseDate(title, "en-GB", refDate);
  if (!date) return null;

  let startTime = DEFAULT_START_TIME;
  if (timeField?.text) {
    const parsed = parse12HourTime(timeField.text.replace(/\./g, ""));
    if (parsed) startTime = parsed;
  }

  const runNumber = parseRunNumber(title);
  const location = resolveN2th3Location(title, locationField);
  const locationUrl = resolveN2th3MapUrl(mapField, location);
  const hares = hareField?.text && !isPlaceholder(hareField.text) ? hareField.text : undefined;

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    title: runNumber ? `N2TH3 Run #${runNumber}` : title,
    hares,
    location,
    locationUrl,
    startTime,
    description: descField?.text || undefined,
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
