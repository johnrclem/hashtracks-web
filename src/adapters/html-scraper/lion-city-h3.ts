import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { MONTHS, decodeEntities, formatAmPmTime } from "../utils";

const DEFAULT_URL = "https://lioncityhhh.com";
const KENNEL_TAG = "lch3";

/**
 * Lion City H3 (Singapore) adapter.
 *
 * lioncityhhh.com is a self-hosted WordPress site that posts a "Hash Run #N"
 * entry roughly weekly under the "This Friday" category. Each post is the
 * pre-trail announcement, published a few days before the actual run.
 *
 * Title:    "Hash Run #2,193"
 * Body:     Date: Friday, 03 April, 6 pm sharp. "Thank God it is Good Friday"
 *           🐰 Hare(s): Lap Dog, Big Head, Cherry Picker
 *           🏃‍♂️ Map – Run Location: Swiss Club Rd, dead end old Turf City
 *           🚇 Nearest MRT: King Albert Park
 *           🚌 Bus: 67, 71, 74, 151
 *           🍻 Map – On On: Red Lantern, opposite
 *
 * The body date has no year — we use the post's publish date to anchor it.
 */

interface ParsedTitle {
  runNumber?: number;
  title: string;
}

/** Parse "Hash Run #2,193" → runNumber 2193, title "Hash Run #2193". */
export function parseLionCityTitle(rawTitle: string): ParsedTitle {
  const decoded = decodeEntities(rawTitle).trim();
  const m = /Hash\s*Run\s*#?\s*([\d,]+)/i.exec(decoded);
  if (!m) return { title: decoded };
  const runNumber = Number.parseInt(m[1].replaceAll(",", ""), 10);
  return {
    runNumber: Number.isFinite(runNumber) ? runNumber : undefined,
    title: `Hash Run #${runNumber}`,
  };
}

interface ParsedBody {
  date?: string;
  startTime?: string;
  hares?: string;
  location?: string;
  onAfter?: string;
}

/**
 * Parse the "Date: Friday, 03 April, 6 pm sharp" line into a date string and
 * (optional) startTime, anchored to the post's publish year.
 */
export function parseLionCityDateLine(
  text: string,
  referenceDate: Date,
): { date?: string; startTime?: string } {
  const dateMatch = /Date:\s*(?:[a-z]+,\s*)?(\d{1,2})\s+([a-z]+)(?:,?\s*(\d{1,2})(?::(\d{2}))?\s*([ap]m))?/i.exec(text);
  if (!dateMatch) return {};

  const day = Number.parseInt(dateMatch[1], 10);
  const monthIdx = MONTHS[dateMatch[2].toLowerCase()];
  if (!monthIdx) return {};

  const year = inferYear(monthIdx, day, referenceDate);
  const date = `${year}-${String(monthIdx).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  if (!dateMatch[3]) return { date };

  const hour = Number.parseInt(dateMatch[3], 10);
  const minute = dateMatch[4] ? Number.parseInt(dateMatch[4], 10) : 0;
  const startTime = formatAmPmTime(hour, minute, dateMatch[5]);
  return { date, startTime };
}

/**
 * Parse Lion City post body (HTML or plain text). Anchored to a reference
 * date so the body date "Friday, 03 April" gets resolved to the right year.
 */
export function parseLionCityBody(html: string, referenceDate: Date): ParsedBody {
  const $ = cheerio.load(html);
  const text = $("body").length ? $("body").text() : $.text();
  const cleaned = text.replaceAll("\u00a0", " ");

  const result: ParsedBody = parseLionCityDateLine(cleaned, referenceDate);

  // Hare(s): emoji optional. The "🐰" prefix may not survive HTML rendering.
  const hareMatch = /Hare\(?s\)?:\s*([^\n]+?)(?:\n|$)/i.exec(cleaned);
  if (hareMatch) result.hares = hareMatch[1].trim();

  // Run Location: handles "Map – Run Location:", "Map - Run Location:", "Run Location:"
  const locMatch = /(?:Map\s*[–-]\s*)?Run\s*Location:\s*([^\n]+?)(?:\n|$)/i.exec(cleaned);
  if (locMatch) result.location = locMatch[1].trim();

  // On On: handles "Map – O n On:" (spaces, common WordPress artifact),
  // "Map - On On:", "On On:", "On-On:"
  const onOnMatch = /(?:Map\s*[–-]\s*)?O\s*n\s*[-–]?\s*On:\s*([^\n]+?)(?:\n|$)/i.exec(cleaned);
  if (onOnMatch) result.onAfter = onOnMatch[1].trim();

  return result;
}

/**
 * Infer the year for a body date that has no year, using the post's publish
 * date as a reference. Lion City posts are always pre-trail, so the run is
 * within ~2 weeks after the publish date.
 *
 * 60-day cutoff: covers any Dec→Jan post published up to ~2 months before the
 * actual run (e.g. an early-November post for a January trail).
 */
function inferYear(month: number, day: number, referenceDate: Date): number {
  const refYear = referenceDate.getUTCFullYear();
  const candidate = new Date(Date.UTC(refYear, month - 1, day, 12));
  const diffDays = (candidate.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < -60) return refYear + 1;
  return refYear;
}

/** Build a RawEventData from a parsed Lion City post. */
export function buildLionCityEvent(
  title: string,
  bodyHtml: string,
  postUrl: string,
  publishDate: Date,
): RawEventData | null {
  const parsedTitle = parseLionCityTitle(title);
  const parsedBody = parseLionCityBody(bodyHtml, publishDate);
  if (!parsedBody.date) return null;
  // RawEventData doesn't have an on-after field; surface it in description.
  const description = parsedBody.onAfter ? `On-On: ${parsedBody.onAfter}` : undefined;
  return {
    date: parsedBody.date,
    startTime: parsedBody.startTime,
    kennelTag: KENNEL_TAG,
    runNumber: parsedTitle.runNumber,
    title: parsedTitle.title,
    description,
    hares: parsedBody.hares,
    location: parsedBody.location,
    sourceUrl: postUrl,
  };
}

export class LionCityH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_URL;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const wpResult = await fetchWordPressPosts(baseUrl, 20);
    if (wpResult.error) {
      errorDetails.fetch = [{ url: baseUrl, message: wpResult.error.message, status: wpResult.error.status }];
      return { events: [], errors: [wpResult.error.message], errorDetails };
    }

    const events: RawEventData[] = [];
    let skippedCount = 0;
    for (const post of wpResult.posts) {
      // Skip non-trail posts (AGM announcements, news, interhash recaps).
      // Real trail posts always have "Hash Run #" in the title.
      if (!/Hash\s*Run\s*#/i.test(post.title)) {
        skippedCount++;
        continue;
      }
      const publishDate = new Date(post.date);
      const event = buildLionCityEvent(post.title, post.content, post.url, publishDate);
      if (event) events.push(event);
      else skippedCount++;
    }

    return {
      events,
      errors,
      diagnosticContext: {
        postsFound: wpResult.posts.length,
        hashRunPosts: wpResult.posts.length - skippedCount,
        eventsParsed: events.length,
        skippedCount,
        fetchDurationMs: wpResult.fetchDurationMs,
      },
    };
  }
}
