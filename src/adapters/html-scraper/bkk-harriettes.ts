import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressComPosts, type WordPressComPage } from "../wordpress-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  normalizeHaresField,
  parse12HourTime,
} from "../utils";

/** Parse ISO string as UTC for chrono reference date anchoring. */
function utcRef(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

/**
 * Bangkok Harriettes Hash House Harriers adapter.
 *
 * bangkokharriettes.wordpress.com is a WordPress.com hosted blog. Unlike most
 * hash blogs where each post is a separate run, Bangkok Harriettes reuses only
 * 3 posts total — they overwrite a single "Next Run" post with updated details.
 * As a result:
 *   - Post publish dates (2000-01-01) are meaningless
 *   - The real date must be parsed from the post body
 *   - Only the most recent body content matters
 *
 * Body fields (in `<strong>` labeled format):
 *   Run Number: <N>
 *   Date: <date>
 *   Time: <time>
 *   Hare: <names>
 *   Location: <place>
 *
 * Weekly Wednesday runs.
 */

const SITE_DOMAIN = "bangkokharriettes.wordpress.com";
const KENNEL_TAG = "bkk-harriettes";
const DEFAULT_START_TIME = "17:30"; // typical Wednesday afternoon

/**
 * Parse a Bangkok Harriettes post into RawEventData.
 *
 * The blog has only 3 posts that get reused. The "Next Run" post body is:
 *   `<strong>Run no. 2259 on Wednesday 15 April at 17:30</strong><br />
 *    <strong>Hare:-</strong> Hazukashii<br />
 *    <strong>Location:- </strong>TBA`
 *
 * The "Run no. NNNN on DAY DATE at TIME" line embeds run#, date, and time.
 * Hare and Location use `:-` as separator.
 *
 * Exported for unit testing.
 */
export function parseBkkHarriettesPost(
  post: WordPressComPage,
): RawEventData | null {
  const $ = cheerio.load(post.content);
  const bodyText = decodeEntities($("body").text().trim());

  // Hoist UTC-normalized refDate once — Bangkok Harriettes hardcode
  // publish dates to 2000-01-01, so use post.modified (reflects when
  // the "Next Run" post was last updated). UTC normalization avoids
  // timezone-dependent year shifts around midnight.
  const refDate = utcRef(post.modified) ?? utcRef(post.date);

  // Pattern 1: "Run no. NNNN on Wednesday 15 April at 17:30"
  const runLineMatch = /Run\s*no\.?\s*(\d+)\s+on\s+(.+?)(?:\s+at\s+(\d{1,2}:\d{2}))?[.,]?\s*$/im.exec(bodyText);

  let date: string | null = null;
  let runNumber: number | undefined;
  let startTime = DEFAULT_START_TIME;

  if (runLineMatch) {
    runNumber = Number.parseInt(runLineMatch[1], 10);
    const dateStr = runLineMatch[2].trim();
    date = chronoParseDate(dateStr, "en-GB", refDate, { forwardDate: true });
    if (runLineMatch[3]) {
      const parsed = parse12HourTime(runLineMatch[3]);
      if (parsed) startTime = parsed;
      else if (/^\d{1,2}:\d{2}$/.test(runLineMatch[3].trim())) startTime = runLineMatch[3].trim();
    }
  }

  // Pattern 2: labeled "Date:" field (fallback for alternate format)
  if (!date) {
    const dateMatch = /(?:^|\b)Date\s*[:-]+\s*(.+?)(?:\n|$)/im.exec(bodyText);
    if (dateMatch) {
      date = chronoParseDate(dateMatch[1], "en-GB", refDate, { forwardDate: true });
    }
  }

  // Pattern 3: labeled "Run Number:" field (fallback)
  if (!runNumber) {
    const numMatch = /Run\s*(?:Number|No|#)\s*[:-]+\s*(\d+)/i.exec(bodyText);
    if (numMatch) runNumber = Number.parseInt(numMatch[1], 10);
  }

  // Fallback: scan full body for any date — still anchor to refDate
  if (!date) {
    date = chronoParseDate(bodyText, "en-GB", refDate, { forwardDate: true });
  }
  if (!date) return null;

  // Extract labeled fields: "Hare:-" and "Location:-"
  const hareMatch = /Hares?\s*[:-]+\s*(.+?)(?=\n|Location|$)/i.exec(bodyText);
  const hares = hareMatch?.[1].trim() || undefined;

  const locationMatch = /Location\s*[:-]+\s*(.+?)(?=\n|Hare|$)/i.exec(bodyText);
  const locationRaw = locationMatch?.[1].trim() || undefined;
  const location = locationRaw && !/^tba|^tbd/i.test(locationRaw) ? locationRaw : undefined;

  // Time from labeled field (fallback if not in run line)
  if (startTime === DEFAULT_START_TIME) {
    const timeMatch = /Time\s*[:-]+\s*(.+?)(?:\n|$)/i.exec(bodyText);
    if (timeMatch) {
      const timeStr = timeMatch[1].replaceAll(".", "").trim();
      const parsed = parse12HourTime(timeStr);
      if (parsed) startTime = parsed;
      else if (/^\d{1,2}:\d{2}$/.test(timeStr)) startTime = timeStr;
    }
  }

  return {
    date,
    kennelTag: KENNEL_TAG,
    runNumber,
    hares: normalizeHaresField(hares),
    location,
    startTime,
    sourceUrl: post.URL,
  };
}

export class BkkHarriettesAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const fetchStart = Date.now();

    // Bangkok Harriettes only maintain ~3 reused posts (they overwrite a
    // single "Next Run" post instead of creating new ones). Filter to only
    // posts whose title/content contains "Run" to skip the static hareline
    // and info pages that would create stale duplicate events.
    const { posts: allPosts, error } = await fetchWordPressComPosts(
      SITE_DOMAIN,
      { number: 5, search: "Run" },
    );
    const posts = allPosts.filter((p) => /run\s*(?:no|#|number)?\s*\.?\s*\d/i.test(p.title + " " + p.content));

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
        const event = parseBkkHarriettesPost(post);
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

    const days = options?.days ?? source.scrapeDays ?? 90;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "wordpress-com-api",
          postsFound: allPosts.length,
          postsFetched: posts.length,
          eventsParsed: events.length,
          fetchDurationMs,
        },
      },
      days,
    );
  }
}
