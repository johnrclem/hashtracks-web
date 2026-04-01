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

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { chronoParseDate } from "../utils";

/**
 * Parse a time string from KCH3 post body.
 * Formats: "8 a.m.", "2 p.m.", "2:00 p.m.", "12:00p", "2:15pm CST", "12:30"
 * Returns "HH:MM" in 24-hour format, or "14:00" as default.
 */
export function parseKCH3Time(timeStr?: string): string {
  if (!timeStr) return "14:00";

  const match = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m?\.?/i.exec(timeStr);
  if (!match) return "14:00";

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].toLowerCase(); // "a" or "p"

  if (ampm === "p" && hours !== 12) hours += 12;
  if (ampm === "a" && hours === 12) hours = 0;

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
 */
export function processKCH3Post(
  titleText: string,
  bodyText: string,
  postUrl: string,
): RawEventData | null {
  // Parse date from the title (e.g., "14 March Snake Saturday Trail", "21 March 2026 SHHHHHHH Trail")
  const dateStr = chronoParseDate(titleText, "en-US", undefined, {
    forwardDate: true,
  });
  if (!dateStr) return null;

  const body = parseKCH3Body(bodyText);
  const startTime = parseKCH3Time(body.time);
  const kennelTag = resolveKennelTag(titleText);

  // Strip date from title to get trail name
  // Remove leading date patterns: "14 March", "21 March 2026", "28 February"
  const trailName = titleText
    .replace(/^\d{1,2}\s+\w+\s*(?:\d{4}\s*)?/i, "")
    .trim() || titleText;

  return {
    date: dateStr,
    kennelTag,
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
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://kansascityh3.com/";

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
      const $ = cheerio.load(post.content);
      // Insert newlines at <br> and <p> boundaries so labeled fields parse correctly
      $("p, br").before("\n");
      const bodyText = $.text();

      const event = processKCH3Post(post.title, bodyText, post.url);
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
}
