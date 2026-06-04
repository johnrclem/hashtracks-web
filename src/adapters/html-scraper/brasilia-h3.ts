import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { applyDateWindow, isPlaceholder, MONTHS, stripHtmlTags } from "../utils";

/**
 * Run heading: `Hash N+340 "Praça dos Orixás Hash"`. The kennel's post-reboot
 * numbering uses an `N+` prefix; `runNumber` stores the bare integer (340).
 * Posts without this marker (away-hash weekends, Hashmas/Earth-Day socials)
 * are not runs and are skipped.
 */
const RUN_RE = /Hash\s+N\+(\d+)/i;

/**
 * In-body date line: `Sunday, 7th of June` — ordinal day + "of" + month name,
 * with NO YEAR. Trailing `\b` so the month group can't eat a glued token
 * ("February14th"). No `/i` flag (Sonar S5869): in this source the month is
 * always a capitalised English name (resolved through the English-only MONTHS
 * map) and the ordinal suffix + "of" are lowercase, so the class never needs
 * case-folding.
 */
const DATE_RE = /(\d{1,2})(?:st|nd|rd|th)?\s+of\s+([A-Za-z]+)\b/;

/**
 * Venue labels, matched per-line (both anchored to the whole line so prose like
 * "start at the park…" — no colon — can never match):
 *  - inline form `Start: <venue>` / `Start Location: <venue>` / `📍 Start: <venue>`
 *    (the venue is on the same line; ~15% of posts)
 *  - heading-only form `📍 Start` / `Start` on its own line, with the venue on
 *    the NEXT line (the 📍 Start pattern used by recent posts, e.g. N+335)
 * Capture starts at a non-space char (Sonar S5852-safe). Posts with neither
 * leave `location` undefined (merge geocodes the kennel/region centroid).
 */
const LOCATION_INLINE_RE = /^(?:📍\s*)?Start(?:\s*Location)?\s*:\s*(\S.*)/i;
const LOCATION_HEADING_RE = /^(?:📍\s*)?Start(?:\s*Location)?\s*:?\s*$/i;

const DEFAULT_BLOG_URL = "https://brasiliah3.blogspot.com/";

/** Structured fields extracted from one Blogspot post body. */
export interface ParsedBrasiliaPost {
  runNumber: number;
  date: string; // YYYY-MM-DD
  location?: string;
  sourceUrl: string;
}

/**
 * The in-body date line carries no year. Pick the year (publishYear − 1,
 * publishYear, or publishYear + 1) that places the run date closest to the
 * post's publish date. This is more robust than a naive "use publishYear, add a
 * year if the date is before publish" rule: it handles both the Dec→Jan
 * announcement rollover AND recap posts published days-to-weeks after the run
 * (a previous-run photo gallery is sometimes prepended, bumping publish later).
 */
function inferDateString(day: number, month: number, publishedIso: string): string | null {
  const published = new Date(publishedIso);
  if (Number.isNaN(published.getTime())) return null;

  const pubYear = published.getUTCFullYear();
  const pubMs = published.getTime();

  let bestUtc: number | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const year of [pubYear - 1, pubYear, pubYear + 1]) {
    const candidate = Date.UTC(year, month - 1, day, 12, 0, 0);
    // Skip impossible dates that Date.UTC silently rolled over (e.g. "31st of
    // February", or "29th of February" in a non-leap year) so a valid sibling
    // year can still win the minimisation instead of being masked by a rolled
    // candidate that happens to land closer to the publish date.
    const resolved = new Date(candidate);
    if (resolved.getUTCDate() !== day || resolved.getUTCMonth() !== month - 1) continue;
    const diff = Math.abs(candidate - pubMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestUtc = candidate;
    }
  }
  if (bestUtc === null) return null;
  return new Date(bestUtc).toISOString().slice(0, 10);
}

/** Parse the `Dth of Month` date line and resolve its year from the publish date. */
function parseRunDate(body: string, publishedIso: string): string | null {
  const match = DATE_RE.exec(body);
  if (!match) return null;
  const day = Number.parseInt(match[1], 10);
  const month = MONTHS[match[2].toLowerCase().slice(0, 3)];
  if (!month || day < 1 || day > 31) return null;
  return inferDateString(day, month, publishedIso);
}

/** Trim a candidate venue, rejecting empty/placeholder text. */
function cleanVenue(text: string): string | undefined {
  const venue = text.trim();
  if (!venue || isPlaceholder(venue)) return undefined;
  return venue;
}

/** Extract a clean venue from a `Start`-labelled line (inline or heading), or undefined. */
function parseLocation(body: string): string | undefined {
  const lines = body.split("\n").map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const inline = LOCATION_INLINE_RE.exec(lines[i]);
    if (inline) return cleanVenue(inline[1]);
    if (LOCATION_HEADING_RE.test(lines[i]) && i + 1 < lines.length) {
      return cleanVenue(lines[i + 1]);
    }
  }
  return undefined;
}

/**
 * Parse a single Brasilia H3 Blogspot post body into structured fields.
 *
 * Post titles are empty on this blog — all run data lives in the flattened
 * body HTML. A post is a run only if it carries a `Hash N+NNN` heading AND a
 * parseable date line; otherwise it returns null (skipped). Hares are
 * deliberately NOT extracted: this blog never uses an inline `Hares:` label,
 * only buried jokey prose, so attempting it would risk field-bleed.
 *
 * Exported so the one-shot history backfill can reuse it as a throwaway
 * extractor over the full Blogger archive (the backfill itself commits the
 * curated JSON output, not this parser).
 */
export function parseBrasiliaPost(
  body: string,
  publishedIso: string,
  url: string,
): ParsedBrasiliaPost | null {
  const runMatch = RUN_RE.exec(body);
  if (!runMatch) return null;
  const runNumber = Number.parseInt(runMatch[1], 10);
  if (!Number.isFinite(runNumber)) return null;

  // Anchor date + venue extraction to the text following the run heading. The
  // canonical body is `Hash N+NNN ...\n<date line>\n... Start: <venue>`, so a
  // prepended recap of a previous run cannot supply an earlier "Dth of Month"
  // or "Start:" line that would otherwise win the first-match search.
  const afterHeading = body.slice(runMatch.index);

  const date = parseRunDate(afterHeading, publishedIso);
  if (!date) return null;

  return {
    runNumber,
    date,
    location: parseLocation(afterHeading),
    sourceUrl: url,
  };
}

/**
 * Brasilia H3 Blogspot Adapter (Brasília, Brazil — HashTracks' first Brazil
 * kennel). Reads brasiliah3.blogspot.com trail announcements via the Blogger
 * API v3 (keyed by GOOGLE_CALENDAR_API_KEY to bypass cloud-IP 403s).
 *
 * Each post is one biweekly Sunday run. Post titles are empty, so run number,
 * date (year inferred from the publish date), and venue are parsed from the
 * post body. Title is intentionally left undefined — the merge pipeline
 * synthesizes "Brasilia H3 Trail #NNN". This adapter fetches a recent window
 * only; the ~186-post archive back to 2019 loads via the one-shot backfill,
 * and `Source.config.upcomingOnly` keeps reconciliation from cancelling it.
 */
export class BrasiliaH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_BLOG_URL;
    const days = options?.days ?? source.scrapeDays ?? 90;

    // 25 posts amply covers scrapeDays=90: at a biweekly cadence that's ~6-7
    // runs plus the occasional social post per window. The full archive loads
    // via the one-shot backfill, not this fetch — bump if scrapeDays grows.
    const bloggerResult = await fetchBloggerPosts(baseUrl, 25);

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    if (bloggerResult.error) {
      const message = `Blogger API fetch failed: ${bloggerResult.error.message}`;
      errors.push(message);
      errorDetails.fetch = [{ url: baseUrl, status: bloggerResult.error.status, message }];
      return { events, errors, errorDetails };
    }

    for (const post of bloggerResult.posts) {
      const body = stripHtmlTags(post.content, "\n");
      const parsed = parseBrasiliaPost(body, post.published, post.url);
      if (!parsed) continue;
      events.push({
        date: parsed.date,
        kennelTags: ["brasilia-h3"],
        runNumber: parsed.runNumber,
        location: parsed.location,
        sourceUrl: parsed.sourceUrl,
      });
    }

    // Fail-loud: a brand-new source has no fill-rate baseline, so a body-format
    // drift that yields zero parses from a non-empty fetch must surface as an
    // error rather than passing silently as "0 events this scrape".
    if (events.length === 0 && bloggerResult.posts.length > 0) {
      errors.push(
        `Brasilia H3: fetched ${bloggerResult.posts.length} posts but parsed 0 run events — body format may have changed`,
      );
    }

    const result: ScrapeResult = {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "blogger-api",
        blogId: bloggerResult.blogId,
        postsFound: bloggerResult.posts.length,
        eventsParsed: events.length,
        fetchDurationMs: bloggerResult.fetchDurationMs,
      },
    };

    return applyDateWindow(result, days);
  }
}
