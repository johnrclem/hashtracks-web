import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  isPlaceholder,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/**
 * KL Junior H3 (Kuala Lumpur Junior Hash House Harriers) adapter.
 *
 * kljhhh.org is a self-hosted WordPress site that publishes one blog post
 * per monthly run. Each post has a title like:
 *   "Run # 532, 6th December 2026 – Christmas Party"
 *   "Run # 524, 5th April – Easter Egg Hunt @ TBD"
 * and a body with labeled fields:
 *   Run-site: <location>
 *   Travel Time: ~1 hour
 *   Date: Sunday 1st November, 2026
 *   Hares: <names>
 *   Co-Hares: <names>
 *   Registration: 1:20 onwards
 *   Run Starts at: 2:00 pm
 *
 * KL Junior is a family hash that meets on the first Sunday of every month
 * at 14:00 — so even when the body omits a start time we have a sensible
 * default (`14:00`).
 *
 * Founded 2 January 1982, ~12 posts per year.
 */

const KENNEL_TAG = "kljhhh";
const DEFAULT_START_TIME = "14:00"; // 2:00 PM, first Sunday monthly
const TITLE_RUN_NUMBER_RE = /Run\s*#\s*(\d+)/i;
const TITLE_DATE_RE =
  /Run\s*#\s*\d+\s*[,:\-]?\s*([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?)/i;

/**
 * Extract labeled fields from an HTML post body.
 *
 * WordPress renders the body with inline styles but the labels themselves
 * are plain text. We strip the HTML to newline-delimited text first, then
 * run a label-anchored regex for each field. Labels stop at the next known
 * label OR a newline (whichever comes first).
 *
 * Exported for unit testing.
 */
export function parseKljBody(bodyHtml: string): {
  date?: string;
  runSite?: string;
  travelTime?: string;
  hares?: string;
  coHares?: string;
  startTime?: string;
  registration?: string;
} {
  const text = stripHtmlTags(bodyHtml, "\n");
  const labels =
    "(?:Run[- ]?site|Travel\\s*Time|Date|Hares?|Co[- ]?Hares?|Registration|Run\\s*Starts?\\s*at|Run\\s*Start|On[- ]?After)";
  const stop = `(?=\\n|${labels}\\s*:|$)`;

  const grab = (label: string): string | undefined => {
    const re = new RegExp(`${label}\\s*:\\s*(.+?)${stop}`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const value = m[1].trim().replace(/\s+/g, " ");
    if (!value || isPlaceholder(value)) return undefined;
    return value;
  };

  const runSite = grab("Run[- ]?site");
  const travelTime = grab("Travel\\s*Time");
  const dateRaw = grab("Date");
  const hares = grab("Hares?");
  const coHares = grab("Co[- ]?Hares?");
  const startRaw = grab("Run\\s*Starts?\\s*at") ?? grab("Run\\s*Start");
  const registration = grab("Registration");

  let date: string | undefined;
  if (dateRaw) {
    const parsed = chronoParseDate(dateRaw, "en-GB");
    if (parsed) date = parsed;
  }

  let startTime: string | undefined;
  if (startRaw) {
    const normalized = startRaw.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm");
    startTime = parse12HourTime(normalized);
  }

  return { date, runSite, travelTime, hares, coHares, startTime, registration };
}

/**
 * Parse "Run # 531, 1st November" (no year) into a "YYYY-MM-DD" using the
 * post's publish year as reference. Exported for unit testing.
 */
export function parseKljTitleDate(title: string, publishDateIso: string): string | null {
  const m = TITLE_DATE_RE.exec(title);
  if (!m) return null;
  // Use the post's publish date as the chrono reference, with forwardDate so
  // year-less dates ("1st November") resolve to the *next* occurrence after
  // the post was published — KLJ posts are always published ahead of the
  // run they announce.
  const refDate = new Date(publishDateIso);
  return chronoParseDate(m[1], "en-GB", refDate, { forwardDate: true });
}

/**
 * Strip the "Run # N, <date> – " prefix from a post title, leaving just
 * the themed title (e.g. "Halloween @ TBD", "Christmas Party"). Also
 * decodes HTML entities left by WordPress (–, &amp;, …).
 *
 * Exported for unit testing.
 */
export function cleanKljTitle(title: string): string {
  const decoded = decodeEntities(title);
  const withoutTags = decoded.replace(/<[^>]+>/g, "").trim();
  // Drop "Run # 532, 6th December 2026 - " / "Run # 524, 5th April – "
  const m = /^Run\s*#\s*\d+\s*[,:\-]?\s*[0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?\s*[–\-]\s*(.+)$/i
    .exec(withoutTags);
  if (m) return m[1].trim();
  return withoutTags;
}

/**
 * KL Junior H3 WordPress adapter.
 */
export class KljH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://www.kljhhh.org";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const wpResult = await fetchWordPressPosts(baseUrl, 20);
    if (wpResult.error || wpResult.posts.length === 0) {
      const message = wpResult.error?.message ?? "KLJ H3 WordPress API returned no posts";
      errorDetails.fetch = [
        { url: baseUrl, message, status: wpResult.error?.status },
      ];
      return { events: [], errors: [message], errorDetails };
    }

    const events: RawEventData[] = [];
    for (let i = 0; i < wpResult.posts.length; i++) {
      const post = wpResult.posts[i];
      const rawTitle = post.title;
      if (!TITLE_RUN_NUMBER_RE.test(rawTitle)) continue; // skip non-run posts

      const runNumMatch = TITLE_RUN_NUMBER_RE.exec(rawTitle);
      const runNumber = runNumMatch ? Number.parseInt(runNumMatch[1], 10) : undefined;

      const body = parseKljBody(post.content);
      const date = body.date ?? parseKljTitleDate(rawTitle, post.date);
      if (!date) {
        errors.push(`KLJ post "${rawTitle.slice(0, 80)}" has no parseable date`);
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: i,
            section: "post",
            field: "date",
            error: "No parseable date in title or body",
            rawText: `Title: ${rawTitle}`.slice(0, 500),
          },
        ];
        continue;
      }

      const title = cleanKljTitle(rawTitle) || undefined;
      const description = body.registration
        ? `Registration: ${body.registration}`
        : undefined;

      events.push({
        date,
        kennelTag: KENNEL_TAG,
        runNumber,
        title,
        hares: body.hares,
        location:
          body.runSite && !isPlaceholder(body.runSite) ? body.runSite : undefined,
        startTime: body.startTime ?? DEFAULT_START_TIME,
        sourceUrl: post.url,
        description,
      });
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "wordpress-api",
          postsFound: wpResult.posts.length,
          eventsParsed: events.length,
          fetchDurationMs: wpResult.fetchDurationMs,
        },
      },
      days,
    );
  }
}
