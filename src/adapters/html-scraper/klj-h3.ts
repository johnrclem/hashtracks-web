import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import {
  applyDateWindow,
  chronoParseDate,
  decodeEntities,
  isPlaceholder,
  normalizeHaresField,
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
// Match the date trailer in two passes (split to keep regex complexity
// under Sonar S5843's threshold of 20): first locate the run-number prefix
// + optional separator, then capture the date token from what follows.
const TITLE_RUN_PREFIX_RE = /Run\s*#\s*\d+\s*[,:-]?\s*/i;
const TITLE_DATE_TOKEN_RE = /^(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?)/;

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
  runSiteTentative?: boolean;
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

  // Strip a leading "probably " qualifier — KLJ posts use it to mark a
  // tentative venue choice; the qualifier belongs in description, not in
  // the location field that drives geocoding. We surface a separate
  // `runSiteTentative` flag so parseKljPost can preserve the source's
  // hedge in the description (#1213, PR #1236 review).
  const runSiteRaw = grab("Run[- ]?site");
  const runSiteTentative = runSiteRaw ? /^probably\s+/i.test(runSiteRaw) : undefined;
  const runSite = runSiteRaw?.replace(/^probably\s+/i, "").trim() || undefined;
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

  return {
    date,
    runSite,
    runSiteTentative,
    travelTime,
    hares,
    coHares,
    startTime,
    registration,
  };
}

/**
 * Parse "Run # 531, 1st November" (no year) into a "YYYY-MM-DD" using the
 * post's publish year as reference. Exported for unit testing.
 */
export function parseKljTitleDate(title: string, publishDateIso: string): string | null {
  // Two-pass split (per Sonar S5843): peel the "Run # N <sep>" prefix,
  // then look for the date token at the start of what's left.
  const prefixMatch = TITLE_RUN_PREFIX_RE.exec(title);
  if (!prefixMatch) return null;
  const trailer = title.slice(prefixMatch.index + prefixMatch[0].length);
  const dateMatch = TITLE_DATE_TOKEN_RE.exec(trailer);
  if (!dateMatch) return null;
  // Use the post's publish date as the chrono reference, with forwardDate so
  // year-less dates ("1st November") resolve to the *next* occurrence after
  // the post was published — KLJ posts are always published ahead of the
  // run they announce.
  const refDate = new Date(publishDateIso);
  return chronoParseDate(dateMatch[1], "en-GB", refDate, { forwardDate: true });
}

/**
 * Strip the "Run # N, <date> ..." prefix from a post title, leaving just
 * the themed title (e.g. "Halloween", "Christmas Party"). Also decodes HTML
 * entities left by WordPress (–, &amp;, …).
 *
 * Returns `undefined` when the post-date trailer is purely a venue (e.g.
 * "Run # 526, 7th June @ Nambee estate, near Rasa") or absent — letting the
 * merge pipeline synthesize a friendlier default like "KLJ H3 Trail #526"
 * with the venue carried separately on `RawEventData.location`. Earlier
 * iterations returned `"Run #N"` here, but the merge pipeline treats that
 * as a stale-default placeholder and re-synthesizes anyway. (#1442)
 *
 * Also strips trailing ` @ <placeholder>` (TBD / TBA / TBC) from themed
 * titles so Shape-B posts like "Halloween @ TBD" don't leak the venue
 * placeholder into the title.
 *
 * Exported for unit testing.
 */
export function cleanKljTitle(title: string): string | undefined {
  const decoded = decodeEntities(title);
  const withoutTags = decoded.replace(/<[^>]+>/g, "").trim();
  const runMatch = /^Run\s*#\s*(\d+)/i.exec(withoutTags);
  if (!runMatch) return withoutTags || undefined;

  let rest = withoutTags.slice(runMatch[0].length).trim();
  // Drop the leading separator after the run number ("Run # 532, …").
  rest = rest.replace(/^[,:\-–—]\s*/, "");
  // Drop the date token ("6th December 2026 ", "1st November ").
  rest = rest.replace(/^\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+(?:\s+\d{4})?\s*/, "");
  // Drop the dash separator between date and themed title ("– Christmas Party").
  rest = rest.replace(/^[–\-—:]\s*/, "");

  // Strip a trailing " @ <placeholder>" — Shape B titles can carry "@ TBD"
  // (or TBA / TBC) when the venue isn't finalized; that's a placeholder, not
  // part of the themed name.
  rest = rest.replace(/\s+@\s+(?:TBD|TBA|TBC)\b\s*$/i, "").trim();

  // Empty trailer or one that opens with a venue marker ("@ …", ", …",
  // "near <Place>") means the post title carries no themed name —
  // return undefined so the merge pipeline picks its own default. The
  // "near" branch requires a following capitalized word so a legitimate
  // themed title like "Near Death Experience" isn't dropped.
  if (!rest || /^[@,]\s/.test(rest) || /^near\s+[A-Z][a-zA-Z]+/.test(rest)) {
    return undefined;
  }
  return rest;
}

/**
 * KL Junior H3 WordPress adapter.
 */
/** A minimal WordPress post shape that `parseKljPost()` needs. */
export interface KljPostInput {
  title: string; // plain text (not HTML)
  content: string; // HTML body
  url: string;
  date: string; // ISO publish date for fallback year resolution
}

/** Result of attempting to convert a KLJ WP post into a RawEventData. */
export type ParseKljPostResult =
  | { ok: true; event: RawEventData }
  | { ok: false; reason: "not-run-post" | "no-date"; title: string };

/**
 * Convert a single KLJ WordPress post into a RawEventData. Returns a
 * discriminated result so both the recurring adapter and the one-shot
 * historical backfill can share this logic AND surface the same errors.
 *
 * Exported for reuse — do NOT duplicate this transform in backfill scripts.
 */
export function parseKljPost(post: KljPostInput): ParseKljPostResult {
  const rawTitle = post.title;
  if (!TITLE_RUN_NUMBER_RE.test(rawTitle)) {
    return { ok: false, reason: "not-run-post", title: rawTitle };
  }

  const runNumMatch = TITLE_RUN_NUMBER_RE.exec(rawTitle);
  const runNumber = runNumMatch ? Number.parseInt(runNumMatch[1], 10) : undefined;

  const body = parseKljBody(post.content);
  const date = body.date ?? parseKljTitleDate(rawTitle, post.date);
  if (!date) return { ok: false, reason: "no-date", title: rawTitle };

  const title = cleanKljTitle(rawTitle);
  // Combine the source's "probably <venue>" hedge (stripped from the
  // location field for clean geocoding — see parseKljBody) with the
  // registration line so neither signal is lost downstream. Sorted in
  // a stable order so the merge fingerprint doesn't churn (#1213 +
  // PR #1236 review).
  const descriptionParts: string[] = [];
  if (body.runSiteTentative && body.runSite) {
    descriptionParts.push(`Run-site: probably ${body.runSite}`);
  }
  if (body.registration) {
    descriptionParts.push(`Registration: ${body.registration}`);
  }
  const description = descriptionParts.length > 0 ? descriptionParts.join("\n") : undefined;

  // Merge hares + coHares into a single normalized field so the
  // fingerprint is stable across scrapes regardless of WP post-body
  // ordering. body.coHares is a secondary list in the post body.
  const mergedHares = [body.hares, body.coHares]
    .filter((s): s is string => !!s && s.length > 0)
    .join(", ");

  return {
    ok: true,
    event: {
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      title,
      hares: normalizeHaresField(mergedHares),
      location:
        body.runSite && !isPlaceholder(body.runSite) ? body.runSite : undefined,
      startTime: body.startTime ?? DEFAULT_START_TIME,
      sourceUrl: post.url,
      description,
    },
  };
}

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
      const result = parseKljPost({
        title: post.title,
        content: post.content,
        url: post.url,
        date: post.date,
      });
      if (result.ok) {
        events.push(result.event);
        continue;
      }
      if (result.reason === "not-run-post") continue; // expected, silent
      // no-date: surface as a parse error
      errors.push(`KLJ post "${result.title.slice(0, 80)}" has no parseable date`);
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
