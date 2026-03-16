import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
} from "../types";
import { hasAnyErrors } from "../types";
import {
  chronoParseDate,
  stripHtmlTags,
  parse12HourTime,
  googleMapsSearchUrl,
  isPlaceholder,
  decodeEntities,
} from "../utils";
import { safeFetch } from "../safe-fetch";

const WPCOM_API =
  "https://public-api.wordpress.com/wp/v2/sites/swh3.wordpress.com";

/** WordPress.com REST API post shape (subset of fields we request) */
interface WPComPost {
  id: number;
  date: string; // ISO 8601 publish date
  link: string;
  title: { rendered: string };
  content: { rendered: string };
}

/**
 * Parse SWH3 post title into run number and trail date.
 *
 * Observed formats:
 *   "SWH3 #1782- Saturday, March 14"
 *   "SWH3 #1781, Saturday, March 7"
 *   "SWH3 Trail #1779, Sunday, Feb. 22"
 *   "SWH3 #1774, SUNDAY Jan. 18"
 */
export function parseSWH3Title(
  title: string,
  publishYear: number,
): { runNumber?: number; date?: string; trailName?: string } {
  // Extract run number
  const runMatch = title.match(/#(\d+)/);
  const runNumber = runMatch ? parseInt(runMatch[1], 10) : undefined;

  // Extract date from the portion after the run number
  const afterRun = runMatch
    ? title.slice(runMatch.index! + runMatch[0].length)
    : title;
  // Strip leading punctuation/whitespace: "- Saturday, March 14" → "Saturday, March 14"
  const dateText = afterRun.replace(/^[\s,\-–—]+/, "").trim();

  // Use chrono-node with reference year from publish date for year inference
  const refDate = new Date(publishYear, 0, 1);
  const date = chronoParseDate(dateText, "en-US", refDate);

  return { runNumber, date: date ?? undefined, trailName: undefined };
}

/**
 * Extract start time from SWH3 time field text.
 *
 * SWH3 posts use varied formats:
 *   "Meet at 2:00 for a 2:30 start" → "14:30" (prefer pack-off time)
 *   "1 PM" → "13:00"
 *   "2 pm gather, 2:30 pack off!" → "14:30"
 *   "at 1 pm (note earlier start time)" → "13:00"
 *
 * Tries parse12HourTime first (handles "1 PM" with explicit am/pm),
 * then looks for "X:XX start/pack" patterns (afternoon assumed if hour ≤ 6).
 */
export function parseSWH3Time(timeText: string): string | undefined {
  // First try standard 12-hour parsing (catches "1 PM", "2:30 pm", "@2pm")
  const standard = parse12HourTime(timeText);
  if (standard) return standard;

  // Look for pack-off/start time: "2:30 start", "2:30 pack off"
  const packOff = timeText.match(/(\d{1,2}):(\d{2})\s*(?:start|pack|go)\b/i);
  if (packOff) {
    let hour = parseInt(packOff[1], 10);
    const min = packOff[2];
    if (hour <= 6) hour += 12; // Afternoon assumption for hash trails
    return `${String(hour).padStart(2, "0")}:${min}`;
  }

  // Look for any H:MM pattern (e.g., "2:00", "2:30")
  const anyTime = timeText.match(/(\d{1,2}):(\d{2})/);
  if (anyTime) {
    let hour = parseInt(anyTime[1], 10);
    const min = anyTime[2];
    if (hour <= 6) hour += 12;
    return `${String(hour).padStart(2, "0")}:${min}`;
  }

  // Bare hour with am/pm: "1 PM", "2pm", "at 1 pm"
  const bareAmPm = timeText.match(/(\d{1,2})\s*(am|pm)/i);
  if (bareAmPm) {
    let hour = parseInt(bareAmPm[1], 10);
    const ampm = bareAmPm[2].toLowerCase();
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  // Bare hour without am/pm: "at 1", "at 2" (afternoon assumed for hash trails)
  const bareHour = timeText.match(/\bat\s+(\d{1,2})\b/i);
  if (bareHour) {
    let hour = parseInt(bareHour[1], 10);
    if (hour <= 6) hour += 12;
    return `${String(hour).padStart(2, "0")}:00`;
  }

  return undefined;
}

/**
 * Parse structured fields from an SWH3 post body.
 *
 * Handles both `<strong>Label:</strong> value` and plain `Label: value` patterns.
 * Fields: Time/When, Where, Hares, On-After, What's da Word (trail theme).
 */
export function parseSWH3Body(html: string): {
  startTime?: string;
  location?: string;
  hares?: string;
  trailName?: string;
  onAfter?: string;
} {
  // Strip related-posts section and HTML tags
  const cleaned = html.replace(/<div[^>]*jp-relatedposts[^>]*>[\s\S]*$/i, "");
  const text = stripHtmlTags(cleaned, "\n");

  // Label-based extraction — each field captures until newline or next known label
  const stop =
    "(?=\\n|(?:Time|When|Where|Hares?|The Hares?|On[ -]After|Notes|Hash Notes|Rego|Website|Next Week)\\s*:|$)";

  // Time / When — extract pack-off/start time from field like "Meet at 2:00 for a 2:30 start"
  const timeMatch = text.match(new RegExp(`(?:Time|When)\\s*:\\s*(.+?)${stop}`, "is"));
  const startTime = timeMatch ? parseSWH3Time(timeMatch[1]) : undefined;

  // Where / Start location
  const whereMatch = text.match(new RegExp(`(?:Where|Start location[^:]*)\\s*:\\s*(.+?)${stop}`, "is"));
  let location = whereMatch ? whereMatch[1].trim() : undefined;
  if (location) {
    // Clean multiline locations: remove "for the hash" suffixes, normalize whitespace
    location = location
      .replace(/\s*for the hash.*$/i, "")
      .replace(/\n/g, ", ")
      .replace(/,\s*,/g, ",")
      .trim();
    if (isPlaceholder(location)) location = undefined;
  }

  // Hares / Hare(s) / The Hares
  const haresMatch = text.match(new RegExp(`(?:The\\s+)?Hares?(?:\\(s\\))?\\s*:\\s*(.+?)${stop}`, "is"));
  let hares = haresMatch ? haresMatch[1].trim() : undefined;
  if (hares && isPlaceholder(hares)) hares = undefined;

  // Trail name from "What's da Word" label
  const wordMatch = text.match(
    /What's da Word[?:]?\s*(.+?)(?=\n|(?:Time|When|Where|Hares?))/is,
  );
  const trailName = wordMatch ? wordMatch[1].trim() : undefined;

  // On-After
  const onAfterMatch = text.match(/On[ -]After:\s*(.+?)(?=\n|$)/i);
  const onAfter = onAfterMatch ? onAfterMatch[1].trim() : undefined;

  return { startTime, location, hares, trailName, onAfter };
}

/** Process a single WordPress.com post into a RawEventData. */
function processPost(
  post: WPComPost,
  index: number,
  errors: string[],
  errorDetails: ErrorDetails,
): RawEventData | null {
  const titleText = decodeEntities(post.title.rendered);
  const publishYear = new Date(post.date).getFullYear();

  const titleFields = parseSWH3Title(titleText, publishYear);
  const bodyFields = parseSWH3Body(post.content.rendered);

  // Event date comes from the title, NOT the publish date
  const date = titleFields.date;
  if (!date) {
    const msg = `No date found in title: "${titleText}"`;
    errors.push(msg);
    (errorDetails.parse ??= []).push({
      row: index,
      section: "post",
      field: "date",
      error: msg,
      rawText: `Title: ${titleText}`.slice(0, 2000),
    });
    return null;
  }

  const location =
    bodyFields.location && !isPlaceholder(bodyFields.location)
      ? bodyFields.location
      : undefined;
  const locationUrl = location ? googleMapsSearchUrl(location) : undefined;

  // Build description from trail name + on-after
  const descParts: string[] = [];
  if (bodyFields.trailName) descParts.push(bodyFields.trailName);
  if (bodyFields.onAfter) descParts.push(`On-After: ${bodyFields.onAfter}`);

  return {
    date,
    kennelTag: "SWH3",
    runNumber: titleFields.runNumber,
    title: bodyFields.trailName || titleText,
    hares: bodyFields.hares,
    location,
    locationUrl,
    startTime: bodyFields.startTime,
    sourceUrl: post.link,
    description: descParts.length > 0 ? descParts.join("\n") : undefined,
  };
}

/**
 * SWH3 (Sir Walter Hash House Harriers) WordPress.com Adapter
 *
 * Fetches trail announcements from swh3.wordpress.com via the WordPress.com
 * public REST API. This is a secondary enrichment source — the primary source
 * is the SWH3 Google Calendar which provides the schedule backbone.
 *
 * Posts have structured fields (Time, Where, Hares) in both <strong>-labeled
 * and plain-text formats.
 */
export class SWH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  /** Trail Announcements category ID on swh3.wordpress.com */
  private static readonly CATEGORY_ID = 644054504;

  async fetch(
    _source: Source,
    _options?: { days?: number },
  ): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const fetchStart = Date.now();

    const url = `${WPCOM_API}/posts?categories=${SWH3Adapter.CATEGORY_ID}&per_page=20&orderby=date&order=desc&_fields=id,date,link,title,content`;

    const resp = await safeFetch(url, {
      headers: {
        "User-Agent": "HashTracks-Scraper",
        Accept: "application/json",
      },
    });

    if (!resp.ok) {
      const msg = `WordPress.com API returned ${resp.status}`;
      errors.push(msg);
      (errorDetails.fetch ??= []).push({
        url,
        status: resp.status,
        message: msg,
      });
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    let posts: WPComPost[];
    try {
      posts = (await resp.json()) as WPComPost[];
    } catch (err) {
      errors.push(`Failed to parse API response: ${err}`);
      return { events, errors, errorDetails, diagnosticContext: { fetchMethod: "wpcom-api" } };
    }

    const fetchDurationMs = Date.now() - fetchStart;

    for (let i = 0; i < posts.length; i++) {
      const event = processPost(posts[i], i, errors, errorDetails);
      if (event) events.push(event);
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "wpcom-api",
        postsFound: posts.length,
        eventsParsed: events.length,
        fetchDurationMs,
      },
    };
  }
}
