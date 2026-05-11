/**
 * Kansas City Hash House Harriers (KCH3) WordPress Trail Scraper
 *
 * Scrapes kansascityh3.com for trail announcements via the WordPress REST API.
 * Post titles contain dates like "14 March Snake Saturday Trail" or
 * "21 March 2026 SHHHHHHH Trail". The body contains labeled fields:
 * Meetup/Meet Up, Hash Cash, Hare, Location.
 *
 * If a post title contains "PNH3" or "Pearl Necklace", the event is tagged
 * as the sister kennel `pnh3` instead of `kch3`.
 *
 * Uses fetchWordPressPosts() from the shared WordPress API utility.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { applyDateWindow, chronoParseDate, htmlToNewlineText } from "../utils";

/** Default start time when the meetup line is missing or unparseable. */
const DEFAULT_START_TIME = "14:00";

/**
 * Parse a time string from KCH3 post body.
 *
 * Two-step parse so a bare hour like "2:00 at: Fox & Hound" doesn't get the
 * `a` in `at` interpreted as the AM marker (#1369):
 *   1. Capture the leading H or H:MM token.
 *   2. Look for an explicit AM/PM marker immediately adjacent to it.
 *
 * When the source omits the AM/PM marker entirely, default to PM (hash
 * convention — trails are afternoon events). Explicit AM tokens are honored.
 *
 * Returns "HH:MM" in 24-hour format, or DEFAULT_START_TIME when no hour is
 * parseable.
 */
export function parseKCH3Time(timeStr?: string): string {
  if (!timeStr) return DEFAULT_START_TIME;
  const t = timeStr.trim();

  const hourMatch = /^(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (!hourMatch) return DEFAULT_START_TIME;
  let hours = Number.parseInt(hourMatch[1], 10);
  const minutes = hourMatch[2] ?? "00";
  if (hours < 0 || hours > 23) return DEFAULT_START_TIME;
  // KCH3 occasionally posts joke times like "Meetup: 1:69" (#1874).
  // Reject minutes outside 00–59 so downstream UTC composition stays valid.
  if (Number.parseInt(minutes, 10) > 59) return DEFAULT_START_TIME;

  // `\b` after `m` / lone `a`/`p` blocks matches like the `a` in `at`
  // (next char is `t` — a word char — so no word boundary).
  const rest = t.slice(hourMatch[0].length);
  const ampmMatch = /^\s*(a\.m\.?|p\.m\.?|am\b|pm\b|a\b|p\b)/i.exec(rest);

  if (ampmMatch) {
    const ampm = ampmMatch[1][0].toLowerCase();
    if (ampm === "p" && hours !== 12) hours += 12;
    if (ampm === "a" && hours === 12) hours = 0;
  } else if (hours < 12) {
    hours += 12;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Parse labeled fields from a KCH3 post body.
 *
 * Extracts meetup time, hash cash, hare(s), and location from the free-text
 * body. Fields are labeled with "Meetup:", "Hash Cash:", "Hare:", "Location:".
 * Some posts use "Meet Up" (two words) or "Meet Up X:XX at:" format.
 */
export function parseKCH3Body(text: string): {
  time?: string;
  hashCash?: string;
  hares?: string;
  location?: string;
  description?: string;
} {
  // Time: "Meetup: 2 p.m." or "Meet Up: 12:00p" or "Meetup 2 p.m." or "Meet Up 2:00 at:"
  const meetupMatch = /Meet\s*[Uu]p:?\s*(.+?)(?=\n|$)/i.exec(text);
  const time = meetupMatch ? meetupMatch[1].trim() : undefined;

  // Hash Cash: "$5" or "5 dolla"
  const cashMatch = /Hash\s*Cash:?\s*(.+?)(?=\n|$)/i.exec(text);
  const hashCash = cashMatch ? cashMatch[1].trim() : undefined;

  // Hare(s): "Hare: Sow Cow Me Maybe" or "Hare(s): ..."
  const hareMatch = /Hares?\s*(?:\([^)]*\))?\s*:?\s*(.+?)(?=\n|$)/i.exec(text);
  const hares = hareMatch ? hareMatch[1].trim() : undefined;

  // Location: "Location: Macken Park 1002 Clark Ferguson Dr..." or address at "Start:"
  const locMatch =
    /Location:?\s*(.+?)(?=\n|$)/i.exec(text) ||
    /Start:?\s*(.+?)(?=\n|$)/i.exec(text) ||
    /Where:?\s*(.+?)(?=\n|$)/i.exec(text);
  const location = locMatch ? locMatch[1].trim() : undefined;

  return { time, hashCash, hares, location };
}

/**
 * Determine kennel tag from post title.
 * Returns "pnh3" for Pearl Necklace events, "kch3" otherwise.
 */
export function resolveKennelTag(title: string): string {
  if (/PNH3|Pearl\s*Necklace/i.test(title)) return "pnh3";
  return "kch3";
}

/**
 * Process a single WordPress post into a RawEventData.
 * Returns null if the post cannot be parsed into a valid event.
 *
 * `publishDate` (ISO timestamp from the WordPress REST API) anchors the year
 * when the title omits it. Without an anchor, chrono `forwardDate` would roll
 * year-less titles past the current date — "28 February" posted in 2026
 * resolves to 2027 instead of 2026 (#1368). Anchoring on the post's publish
 * date lets chrono pick the year nearest to publication.
 */
export function processKCH3Post(
  titleText: string,
  bodyText: string,
  postUrl: string,
  publishDate?: string,
): RawEventData | null {
  // A malformed non-empty publishDate yields `new Date(NaN)`, which chrono
  // honors as the reference and then drops the parse — silently losing the
  // event. Fall back to undefined so chrono uses its own default.
  let refDate: Date | undefined;
  if (publishDate) {
    const parsed = new Date(publishDate);
    if (!Number.isNaN(parsed.getTime())) refDate = parsed;
  }
  const dateStr = chronoParseDate(titleText, "en-US", refDate);
  if (!dateStr) return null;

  const body = parseKCH3Body(bodyText);
  const startTime = parseKCH3Time(body.time);
  const kennelTag = resolveKennelTag(titleText);

  const trailName = titleText
    .replace(/^\d{1,2}\s+\w+\s*(?:\d{4}\s*)?/i, "")
    .trim() || titleText;

  return {
    date: dateStr,
    kennelTags: [kennelTag],
    title: trailName,
    hares: body.hares,
    location: body.location,
    startTime,
    sourceUrl: postUrl,
    description: body.hashCash ? `Hash Cash: ${body.hashCash}` : undefined,
  };
}

/**
 * KCH3 WordPress Trail Scraper
 *
 * Scrapes kansascityh3.com for trail announcements via the WordPress REST API.
 * Each post title contains the date and trail name. Body contains structured
 * fields: Meetup time, Hash Cash, Hare, Location.
 */
export class KCH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://kansascityh3.com/";
    const days = options?.days ?? source.scrapeDays ?? 365;

    const wpResult = await fetchWordPressPosts(baseUrl);

    if (wpResult.error) {
      return {
        events: [],
        errors: [wpResult.error.message],
        errorDetails: {
          fetch: [
            {
              url: baseUrl,
              status: wpResult.error.status,
              message: wpResult.error.message,
            },
          ],
        },
      };
    }

    const events: RawEventData[] = [];

    for (const post of wpResult.posts) {
      const bodyText = htmlToNewlineText(post.content);
      const event = processKCH3Post(post.title, bodyText, post.url, post.date);
      if (event) events.push(event);
    }

    return applyDateWindow({
      events,
      errors: [],
      diagnosticContext: {
        fetchMethod: "wordpress-api",
        postsFound: wpResult.posts.length,
        fetchDurationMs: wpResult.fetchDurationMs,
      },
    }, days);
  }
}
