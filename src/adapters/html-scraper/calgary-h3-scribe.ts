/**
 * Calgary H3 Scribe Adapter (WordPress REST API)
 *
 * Scrapes scribe.onon.org for trail write-ups via the WordPress REST API.
 * These are post-run "scribe" reports, not future events — but they contain
 * structured run data useful for historical import and enrichment.
 *
 * Post title format: "Run 2453 – A Hot Slippy Thong in the Cheeks"
 * Post body contains labeled fields: Hares:, Location:, RA:, Attendance:
 *
 * kennelTag: "ch3-ab"
 */

import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { chronoParseDate, filterEventsByWindow, stripPlaceholder } from "../utils";

const KENNEL_TAG = "ch3-ab";

/**
 * Parse a Calgary Scribe post title into run number and trail name.
 *
 * Formats:
 *   "Run 2453 – A Hot Slippy Thong in the Cheeks"
 *   "Run 2450 – Ode to Joy"
 *   "Run 2449"
 */
export function parseScribeTitle(title: string): {
  runNumber?: number;
  trailName?: string;
} | null {
  const match = /^Run\s+(\d+)\s*[-–—]\s*(.+)/i.exec(title);
  if (match) {
    return {
      runNumber: Number.parseInt(match[1], 10),
      trailName: match[2].trim() || undefined,
    };
  }

  // "Run 2449" without a trail name
  const numOnly = /^Run\s+(\d+)/i.exec(title);
  if (numOnly) {
    return {
      runNumber: Number.parseInt(numOnly[1], 10),
    };
  }

  // Unrecognized format — treat entire title as trail name
  if (title.trim()) {
    return { trailName: title.trim() };
  }
  return null;
}

/**
 * Parse labeled fields from a Calgary Scribe post body.
 *
 * Extracts: Hares, Location, RA (Religious Advisor), Attendance
 */
export function parseScribeBody(text: string): {
  hares?: string;
  location?: string;
  ra?: string;
  attendance?: string;
} {
  const haresMatch = /Hares?:\s*(.+?)(?=\n|$)/i.exec(text);
  const locationMatch = /Location:\s*(.+?)(?=\n|$)/i.exec(text);
  const raMatch = /RA:\s*(.+?)(?=\n|$)/i.exec(text);
  const attendanceMatch = /Attendance:\s*(.+?)(?=\n|$)/i.exec(text);

  return {
    hares: stripPlaceholder(haresMatch?.[1]),
    location: stripPlaceholder(locationMatch?.[1]),
    ra: stripPlaceholder(raMatch?.[1]),
    attendance: stripPlaceholder(attendanceMatch?.[1]),
  };
}

/**
 * Process a single WordPress post into a RawEventData.
 * Returns null if the post cannot be parsed into a valid event.
 */
export function processScribePost(
  titleText: string,
  bodyText: string,
  postUrl: string,
  postDate: string,
): RawEventData | null {
  const parsed = parseScribeTitle(titleText);
  if (!parsed) return null;

  const body = parseScribeBody(bodyText);

  // Use the WordPress post date as event date (scribe posts are typically
  // published within a few days of the run)
  const dateStr = chronoParseDate(postDate, "en-US");
  if (!dateStr) return null;

  const descParts: string[] = [];
  if (body.ra) descParts.push(`RA: ${body.ra}`);
  if (body.attendance) descParts.push(`Attendance: ${body.attendance}`);

  return {
    date: dateStr,
    kennelTag: KENNEL_TAG,
    runNumber: parsed.runNumber,
    title: parsed.trailName,
    hares: body.hares,
    location: body.location,
    sourceUrl: postUrl,
    description: descParts.length > 0 ? descParts.join(" | ") : undefined,
  };
}

/**
 * Calgary H3 Scribe WordPress REST API Adapter
 *
 * Scrapes scribe.onon.org for trail write-ups via the WordPress REST API.
 * Uses fetchWordPressPosts() from the shared WordPress API utility.
 */
export class CalgaryH3ScribeAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://scribe.onon.org/";
    // Honor source.scrapeDays via options.days (default 365)
    const days = options?.days ?? source.scrapeDays ?? 365;

    const wpResult = await fetchWordPressPosts(baseUrl, 20);

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

      const event = processScribePost(post.title, bodyText, post.url, post.date);
      if (event) events.push(event);
    }

    return {
      events: filterEventsByWindow(events, days),
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
