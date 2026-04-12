import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  normalizeHaresField,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/** Parse ISO string as UTC for chrono reference date anchoring. */
function utcRef(iso: string | undefined): Date | undefined {
  if (!iso) return undefined;
  return new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
}

/**
 * Cha-Am Hash House Harriers (CAH3) adapter.
 *
 * cah3.net is a self-hosted WordPress site that publishes one blog post per
 * monthly run. Post titles follow patterns like:
 *   "Run 534: Songkran Outstation APR 10 & 11"
 *   "Run 533 Saturday 8th March 2025"
 *   "Run 532 Saturday February 8 2025"
 *
 * The body typically contains labeled fields:
 *   Hare: <name>
 *   Location: <place>
 *   Time: <time>
 *
 * Monthly Saturday runs in the Hua Hin / Cha-Am area.
 */

const KENNEL_TAG = "cah3";
const DEFAULT_START_TIME = "16:00"; // typical Saturday afternoon hash
const TITLE_RUN_RE = /Run\s*#?\s*(\d+)/i;

/**
 * Parse a CAH3 post title for date and run number.
 * Exported for unit testing.
 */
export function parseCah3Title(title: string, publishDateIso: string): {
  runNumber?: number;
  date?: string;
  title?: string;
} {
  const decoded = decodeEntities(title);

  const runMatch = TITLE_RUN_RE.exec(decoded);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // Strip "Run NNN:" prefix to get the descriptive part
  const stripped = decoded.replace(/^Run\s*#?\s*\d+\s*[:\-–]?\s*/i, "").trim();

  // Parse date from the remaining title text using the publish date as reference
  const refDate = utcRef(publishDateIso);
  const date = chronoParseDate(stripped, "en-GB", refDate, { forwardDate: true })
    ?? chronoParseDate(decoded, "en-GB", refDate, { forwardDate: true });

  return {
    runNumber,
    date: date ?? undefined,
    title: stripped || undefined,
  };
}

/**
 * Extract labeled fields from a CAH3 post body.
 * Exported for unit testing.
 */
export function parseCah3Body(bodyHtml: string): {
  hares?: string;
  location?: string;
  startTime?: string;
  date?: string;
} {
  const text = decodeEntities(stripHtmlTags(bodyHtml, "\n"));
  const labels = "(?:Hares?|Location|Time|Date|Start|Run\\s*Site|On\\s*After|Meeting\\s*Point)";
  const stop = `(?=\\n|${labels}\\s*:|$)`;

  const grab = (label: string): string | undefined => {
    const re = new RegExp(`${label}\\s*:\\s*(.+?)${stop}`, "i");
    const m = re.exec(text);
    if (!m) return undefined;
    const value = m[1].trim().replace(/\s+/g, " ");
    return value || undefined;
  };

  const hares = grab("Hares?");
  const location = grab("Location") ?? grab("Run\\s*Site") ?? grab("Meeting\\s*Point");
  const timeRaw = grab("Time") ?? grab("Start");
  let startTime: string | undefined;
  if (timeRaw) {
    const normalized = timeRaw.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm");
    const parsed = parse12HourTime(normalized);
    if (parsed) startTime = parsed;
    else if (/^\d{1,2}:\d{2}$/.test(normalized.trim())) startTime = normalized.trim();
  }

  const dateRaw = grab("Date");
  const date = dateRaw ? chronoParseDate(dateRaw, "en-GB") ?? undefined : undefined;

  return { hares, location, startTime, date };
}

/** A minimal WordPress post shape for parsePost. */
export interface Cah3PostInput {
  title: string;
  content: string;
  url: string;
  date: string;
}

/** Result of parsing a CAH3 post. */
export type ParseCah3PostResult =
  | { ok: true; event: RawEventData }
  | { ok: false; reason: "not-run-post" | "no-date"; title: string };

/**
 * Parse a single CAH3 WordPress post into RawEventData.
 *
 * CAH3 posts often don't have a date in the title (e.g. "Run 533: Saurkrap's
 * Cat Sanctuary Run") or body. When no date can be parsed from title or body,
 * the post is skipped (returns `no-date`) rather than using the WordPress
 * publish date, which is the announcement date and may be several days
 * before the actual Saturday run.
 *
 * Exported for unit testing.
 */
export function parseCah3Post(post: Cah3PostInput): ParseCah3PostResult {
  const rawTitle = post.title;
  if (!TITLE_RUN_RE.test(rawTitle)) {
    return { ok: false, reason: "not-run-post", title: rawTitle };
  }

  const titleFields = parseCah3Title(rawTitle, post.date);
  const body = parseCah3Body(post.content);

  // Try title date, then body date. Do NOT fall back to the WordPress
  // publish date — it's the announcement date and may be several days
  // before the actual Saturday run, which would emit events on the
  // wrong day and break calendar accuracy + fingerprint dedup.
  const date = body.date ?? titleFields.date;
  if (!date) return { ok: false, reason: "no-date", title: rawTitle };

  // Try to extract a Google Maps link from the body as locationUrl
  const mapsMatch = /href=["']?(https?:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.com\/maps)[^"'\s>]+)/i.exec(post.content);
  const locationUrl = mapsMatch?.[1];

  return {
    ok: true,
    event: {
      date,
      kennelTag: KENNEL_TAG,
      runNumber: titleFields.runNumber,
      title: titleFields.title,
      hares: normalizeHaresField(body.hares),
      location: body.location,
      locationUrl,
      startTime: body.startTime ?? DEFAULT_START_TIME,
      sourceUrl: post.url,
    },
  };
}

export class Cah3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://cah3.net";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    const wpResult = await fetchWordPressPosts(baseUrl, 20);
    if (wpResult.error || wpResult.posts.length === 0) {
      const message = wpResult.error?.message ?? "CAH3 WordPress API returned no posts";
      errorDetails.fetch = [
        { url: baseUrl, message, status: wpResult.error?.status },
      ];
      return { events: [], errors: [message], errorDetails };
    }

    const events: RawEventData[] = [];
    for (let i = 0; i < wpResult.posts.length; i++) {
      const post = wpResult.posts[i];
      const result = parseCah3Post({
        title: post.title,
        content: post.content,
        url: post.url,
        date: post.date,
      });
      if (result.ok) {
        events.push(result.event);
        continue;
      }
      if (result.reason === "not-run-post") continue;
      errors.push(`CAH3 post "${result.title.slice(0, 80)}" has no parseable date`);
      errorDetails.parse = [
        ...(errorDetails.parse ?? []),
        {
          row: i,
          section: "post",
          field: "date",
          error: "No parseable date in title or body",
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
