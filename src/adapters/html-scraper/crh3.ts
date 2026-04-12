import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  normalizeHaresField,
  stripHtmlTags,
} from "../utils";

/**
 * Chiang Rai Hash House Harriers (CRH3) adapter.
 *
 * chiangraihhh.blogspot.com is a Blogger-hosted blog with 364+ posts.
 * Run announcements have titles matching patterns like:
 *   "CRH3#220"
 *   "CRH3 #218 Saturday 15th February 2025"
 *   "CRH3#217 HAPPY NEW YEAR RUN"
 *
 * Posts are freeform with emojis and variable formatting. The body often
 * contains date, location, and hare info in plain text. Monthly 3rd Saturday.
 */

const KENNEL_TAG = "crh3";
const DEFAULT_START_TIME = "15:00"; // 3rd Saturday monthly, 3:00 PM start per Chrome research
/** Matches CRH3 run posts with or without a run number. */
const RUN_TITLE_RE = /CRH3\s*#?\s*\d*/i;
/** Extracts the run number if present. */
const RUN_NUMBER_RE = /CRH3\s*#?\s*(\d+)/i;

/**
 * Parse a CRH3 post title for run number and optional date.
 * Exported for unit testing.
 */
export function parseCrh3Title(title: string, publishDateIso: string): {
  runNumber?: number;
  date?: string;
} {
  const decoded = decodeEntities(title);
  const runMatch = RUN_NUMBER_RE.exec(decoded);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // Strip "CRH3#NNN" or "CRH3" prefix and try to parse remaining text as a date
  const stripped = decoded.replace(/CRH3\s*#?\s*\d*\s*/i, "").trim();
  const refDate = new Date(publishDateIso);
  const date = chronoParseDate(stripped, "en-GB", refDate, { forwardDate: true })
    ?? chronoParseDate(decoded, "en-GB", refDate, { forwardDate: true });

  return { runNumber, date: date ?? undefined };
}

/**
 * Extract fields from a CRH3 post body. The body is freeform text with
 * emoji separators. We look for date, hare, and location patterns.
 * Exported for unit testing.
 */
export function parseCrh3Body(bodyHtml: string, publishDateIso: string): {
  date?: string;
  hares?: string;
  location?: string;
} {
  const text = stripHtmlTags(bodyHtml, "\n")
    // Strip emoji characters that might interfere with regex
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ");

  // Use newline-delimited text with label-anchored regexes that stop at
  // the next known label or newline to avoid greedy over-matching.
  const labels = "(?:Hares?|GM|Grand Master|Location|Run\\s*Site|Start|Meeting|Time|Date|On\\s*After)";
  const stop = `(?=\\n|${labels}\\s*[=:]|$)`;

  const grab = (label: string): string | undefined => {
    const re = new RegExp(`(?:${label})\\s*[=:]\\s*(.+?)${stop}`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const value = m[1].trim().replace(/\s+/g, " ");
    return value || undefined;
  };

  const hares = grab("Hares?|GM|Grand Master");
  const location = grab("Location|Run\\s*Site|Meeting");

  // Try to find a date in the body
  const refDate = new Date(publishDateIso);
  const date = chronoParseDate(text, "en-GB", refDate, { forwardDate: true }) ?? undefined;

  return { date, hares, location };
}

/** A minimal Blogger post shape for parsePost. */
export interface Crh3PostInput {
  title: string;
  content: string;
  url: string;
  published: string;
}

/** Result of parsing a CRH3 post. */
export type ParseCrh3PostResult =
  | { ok: true; event: RawEventData }
  | { ok: false; reason: "not-run-post" | "no-date"; title: string };

/**
 * Parse a single CRH3 Blogger post into RawEventData.
 * Exported for unit testing.
 */
export function parseCrh3Post(post: Crh3PostInput): ParseCrh3PostResult {
  const rawTitle = post.title;
  if (!RUN_TITLE_RE.test(rawTitle)) {
    return { ok: false, reason: "not-run-post", title: rawTitle };
  }

  const titleFields = parseCrh3Title(rawTitle, post.published);
  const body = parseCrh3Body(post.content, post.published);

  const date = titleFields.date ?? body.date;
  if (!date) return { ok: false, reason: "no-date", title: rawTitle };

  return {
    ok: true,
    event: {
      date,
      kennelTag: KENNEL_TAG,
      runNumber: titleFields.runNumber,
      hares: normalizeHaresField(body.hares),
      location: body.location,
      startTime: DEFAULT_START_TIME,
      sourceUrl: post.url,
    },
  };
}

export class Crh3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://chiangraihhh.blogspot.com";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const bloggerResult = await fetchBloggerPosts(baseUrl);
    if (bloggerResult.error) {
      errorDetails.fetch = [
        {
          url: baseUrl,
          message: bloggerResult.error.message,
          status: bloggerResult.error.status,
        },
      ];
      return { events: [], errors: [bloggerResult.error.message], errorDetails };
    }

    const events: RawEventData[] = [];
    let filteredOut = 0;
    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const post = bloggerResult.posts[i];
      const result = parseCrh3Post({
        title: post.title,
        content: post.content,
        url: post.url,
        published: post.published,
      });
      if (result.ok) {
        events.push(result.event);
        continue;
      }
      if (result.reason === "not-run-post") {
        filteredOut++;
        continue;
      }
      errors.push(`CRH3 post "${result.title.slice(0, 80)}" has no parseable date`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        {
          row: i,
          section: "post",
          field: "date",
          error: "No parseable date",
          rawText: `Title: ${result.title}`.slice(0, 500),
        },
      ];
    }

    const days = options?.days ?? source.scrapeDays ?? 365;
    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "blogger-api",
          blogId: bloggerResult.blogId,
          postsFound: bloggerResult.posts.length,
          postsFilteredOut: filteredOut,
          eventsParsed: events.length,
          fetchDurationMs: bloggerResult.fetchDurationMs,
        },
      },
      days,
    );
  }
}
