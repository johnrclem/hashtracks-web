import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { applyDateWindow, chronoParseDate } from "../utils";

/**
 * Parse a Voodoo H3 post title into run number and trail name.
 *
 * Formats:
 *   "Trail #1035: The Egg-Stra Dirty Spring Scramble"
 *   "Trail #1031: Suburban Jungle"
 *   "Trail #1026: Awards Season!"
 */
export function parseVoodooTitle(title: string): {
  runNumber?: number;
  trailName?: string;
} | null {
  const match = /Trail\s*#(\d+)(?::\s*(.+))?/i.exec(title);
  if (match) {
    return {
      runNumber: Number.parseInt(match[1], 10),
      trailName: match[2]?.trim() || undefined,
    };
  }
  // If no "Trail #" pattern, treat entire title as trail name
  if (title.trim()) {
    return { trailName: title.trim() };
  }
  return null;
}

/**
 * Parse labeled fields from a Voodoo H3 post body.
 *
 * Extracts date, time, start address, hares, on-after, pre-lube, and theme
 * from the free-text body. Fields are labeled with "Date:", "Time:", etc.
 */
export function parseVoodooBody(text: string): {
  date?: string;
  time?: string;
  location?: string;
  hares?: string;
  onAfter?: string;
  preLube?: string;
  theme?: string;
  dogFriendly?: string;
} {
  const dateMatch = /Date:\s*(.+?)(?=\n|$)/i.exec(text);
  const timeMatch = /Time:\s*(.+?)(?=\n|$)/i.exec(text);
  const addressMatch = /(?:Start\s*)?Address:\s*(.+?)(?=\n|$)/i.exec(text);
  const hareMatch = /Hares?\s*(?:&\s*Co-Hares?)?\s*:\s*(.+?)(?=\n|$)/i.exec(text);
  const onAfterMatch = /On[- ]?After:\s*(.+?)(?=\n|$)/i.exec(text);
  const prelubeMatch = /Pre[- ]?Lube:\s*(.+?)(?=\n|$)/i.exec(text);
  const themeMatch = /Theme:\s*(.+?)(?=\n|$)/i.exec(text);
  const dogMatch = /Dog\s*Friendly[?:]?\s*(.+?)(?=\n|$)/i.exec(text);

  return {
    date: dateMatch ? dateMatch[1].trim() : undefined,
    time: timeMatch ? timeMatch[1].trim() : undefined,
    location: addressMatch ? addressMatch[1].trim() : undefined,
    hares: hareMatch ? hareMatch[1].trim() : undefined,
    onAfter: onAfterMatch ? onAfterMatch[1].trim() : undefined,
    preLube: prelubeMatch ? prelubeMatch[1].trim() : undefined,
    theme: themeMatch ? themeMatch[1].trim() : undefined,
    dogFriendly: dogMatch ? dogMatch[1].trim() : undefined,
  };
}

/**
 * Extract a start time from the Time field.
 * Voodoo posts typically say "6:30pm show, 7:00pm GO!" — we want the show time.
 * Falls back to "18:30" if unparseable.
 */
export function parseVoodooTime(timeStr?: string): string {
  if (!timeStr) return "18:30";

  // Match first time in the string (e.g., "6:30pm", "5:30pm", "6pm", "7pm")
  const match = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(timeStr);
  if (!match) return "18:30";

  let hours = Number.parseInt(match[1], 10);
  const minutes = match[2] || "00";
  const ampm = match[3].toLowerCase();

  if (ampm === "pm" && hours !== 12) hours += 12;
  if (ampm === "am" && hours === 12) hours = 0;

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Process a single WordPress post into a RawEventData.
 * Returns null if the post cannot be parsed into a valid event.
 */
export function processVoodooPost(
  titleText: string,
  bodyText: string,
  postUrl: string,
): RawEventData | null {
  const parsed = parseVoodooTitle(titleText);
  if (!parsed) return null;

  const body = parseVoodooBody(bodyText);

  // Parse date from body "Date:" field — forwardDate avoids wrong year near boundaries
  const dateStr = body.date ? chronoParseDate(body.date, "en-US", undefined, { forwardDate: true }) : null;
  if (!dateStr) return null;

  const startTime = parseVoodooTime(body.time);

  const descParts: string[] = [];
  if (body.theme) descParts.push(`Theme: ${body.theme}`);
  if (body.preLube) descParts.push(`Pre-Lube: ${body.preLube}`);
  if (body.onAfter) descParts.push(`On-After: ${body.onAfter}`);

  return {
    date: dateStr,
    kennelTags: ["voodoo-h3"],
    runNumber: parsed.runNumber,
    title: parsed.trailName,
    hares: body.hares,
    location: body.location,
    startTime,
    sourceUrl: postUrl,
    description: descParts.length > 0 ? descParts.join(" | ") : undefined,
  };
}

/**
 * Voodoo H3 WordPress Trail Scraper
 *
 * Scrapes voodoohash.com for trail announcements via the WordPress REST API.
 * Each post title contains "Trail #NNNN: Trail Name" and the body contains
 * structured fields: Date, Time, Start Address, Hare(s), Pre-Lube, On-After.
 *
 * Uses fetchWordPressPosts() from the shared WordPress API utility.
 */
export class VoodooH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.voodoohash.com/";
    // Honor source.scrapeDays via options.days (default 365)
    const days = options?.days ?? source.scrapeDays ?? 365;

    const wpResult = await fetchWordPressPosts(baseUrl);

    if (wpResult.error) {
      return {
        events: [],
        errors: [wpResult.error.message],
        errorDetails: {
          fetch: [{ url: baseUrl, status: wpResult.error.status, message: wpResult.error.message }],
        },
      };
    }

    const events: RawEventData[] = [];

    for (const post of wpResult.posts) {
      const $ = cheerio.load(post.content);
      // Insert newlines at <br> and <p> boundaries so labeled fields parse correctly
      $("p, br").before("\n");
      const bodyText = $.text();

      const event = processVoodooPost(post.title, bodyText, post.url);
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
