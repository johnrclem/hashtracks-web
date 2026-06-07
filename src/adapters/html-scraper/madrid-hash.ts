import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchWordPressPosts } from "../wordpress-api";
import { applyDateWindow, chronoParseDate, WEEKDAY_NAMES } from "../utils";

/**
 * Number of recent posts the forward adapter pulls each scrape. The full
 * archive (~550–600 runs back to 2014) is owned by the one-shot backfill
 * (`scripts/backfill-madrid-h3-history.ts`); the source carries
 * `config.upcomingOnly: true` so reconcile only touches future dates. The WP
 * server ignores `_fields` and returns bloated posts (~7 KB each), so keep
 * this modest.
 */
const FORWARD_PER_PAGE = 30;

/** Madrid HHH base site (self-hosted WordPress). */
const DEFAULT_BASE_URL = "https://madridhhh.com/";

/**
 * Parse the decimal GPS pair from a Madrid `GPS:` line. The line reads e.g.
 *   `[40°27’15.7″N 3°37’45.7″W] or [40.454352, -3.629372]`
 * Take the bracketed DECIMAL pair (order: lat, lng — Spain → lat ~+40,
 * lng ~−3/−4). Older posts that only carry a DMS string or a bare maps link
 * (no decimal bracket) return undefined — the merge pipeline geocodes those
 * from the location text / maps URL instead.
 */
export function parseMadridGps(
  gpsLine: string | undefined,
): { lat: number; lng: number } | undefined {
  if (!gpsLine) return undefined;
  const m = /\[\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\]/.exec(gpsLine);
  if (!m) return undefined;
  return { lat: Number.parseFloat(m[1]), lng: Number.parseFloat(m[2]) };
}

/**
 * Extract the run theme from a Madrid post title. Titles are stylized as
 *   `The “Habemus Papadam” R*n`
 * Return the bare quoted segment ("Habemus Papadam"). Handles curly and
 * straight quotes. Returns undefined when no quoted theme is present.
 */
export function parseMadridTheme(postTitle: string): string | undefined {
  const m = /["“]([^"”]+)["”]/.exec(postTitle);
  return m?.[1]?.trim() || undefined;
}

/** First label-line value (`.+` stops at the inserted newline). */
function labelValue(body: string, label: RegExp): string | undefined {
  return label.exec(body)?.[1]?.trim() || undefined;
}

/**
 * The in-body `Date:` line is authoritative for the normal case (posts publish
 * ~2–5 days BEFORE the run, so `post.date` would mis-date every event). But the
 * 11-year archive carries a few hand-typed quirks the body date alone can't
 * survive: year-less lines ("Sunday 17th December"), month typos ("Januray"),
 * and copy-pasted stale dates (a 2022 post stamped "14th July 2019"). The
 * publish date is the corrective signal — runs always fall on the line's named
 * weekday within a week AFTER publication (measured: clean-row gap is −2…+7d).
 *
 * Resolution:
 *   1. Parse the line with chrono, anchored to the publish date — this alone
 *      fixes year-less lines and unparseable-month typos (chrono infers the
 *      year/month nearest the reference).
 *   2. If the parsed date still lands > MAX_PUBLISH_GAP_DAYS from publication,
 *      the line's explicit year (or day) is a stale copy-paste — re-anchor to
 *      the line's named weekday on-or-after the publish date.
 *
 * Without a publish date (e.g. direct unit tests), the body date is trusted
 * verbatim.
 */
const MAX_PUBLISH_GAP_DAYS = 45;
const MS_PER_DAY = 86_400_000;

/** "YYYY-MM-DD" → epoch ms at UTC noon (avoids DST edges). */
function isoToUtcNoon(iso: string): number {
  return Date.parse(`${iso}T12:00:00Z`);
}

/**
 * First occurrence of the weekday named in `dateLine`, on or after `pubIso`
 * (a "YYYY-MM-DD" string). Returns undefined when the line names no weekday.
 */
function nextNamedWeekdayOnOrAfter(
  dateLine: string,
  pubIso: string,
): string | undefined {
  const m = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(
    dateLine,
  );
  if (!m) return undefined;
  const targetDow = WEEKDAY_NAMES[m[1].toUpperCase()];
  const start = new Date(`${pubIso}T12:00:00Z`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * MS_PER_DAY);
    if (d.getUTCDay() === targetDow) return d.toISOString().slice(0, 10);
  }
  return undefined;
}

export function resolveRunDate(
  dateLine: string,
  publishDate?: string,
): string | null {
  const pubIso = publishDate?.slice(0, 10);
  const refDate = pubIso ? new Date(`${pubIso}T12:00:00Z`) : undefined;
  const parsed = chronoParseDate(dateLine, "en-GB", refDate);
  if (!parsed) return null;
  if (!pubIso) return parsed;

  // Only PAST-stale dates are corrected: the archive's date errors are always
  // copy-pasted OLD dates (parsed lands well BEFORE publication). A date well
  // AFTER publication is a legitimately far-in-advance announcement — leave it.
  const daysBeforePublish =
    (isoToUtcNoon(pubIso) - isoToUtcNoon(parsed)) / MS_PER_DAY;
  if (daysBeforePublish <= MAX_PUBLISH_GAP_DAYS) return parsed;

  // Stale copy-pasted year/day — re-anchor to the named weekday near publish.
  return nextNamedWeekdayOnOrAfter(dateLine, pubIso) ?? parsed;
}

/**
 * Parse a single Madrid run post body into a RawEventData. Every run datum is
 * labeled in the post body (`Run No.` / `Date` / `Time` / `Location` / `GPS` /
 * `Google Maps` / `Hares`). Returns null for non-run posts (no `Run No.` line)
 * or when the in-body date can't be parsed.
 *
 * The in-body `Date:` line is authoritative, corrected against `publishDate`
 * for the archive's year-less / typo'd / copy-pasted date quirks (see
 * `resolveRunDate`).
 */
export function parseMadridRunBody(
  body: string,
  postTitle: string,
  url: string,
  publishDate?: string,
): RawEventData | null {
  // Run marker (run / non-run filter). Require a leading digit so a stray
  // "Run No.: ." can't capture a bare dot → NaN run number.
  const runNoRaw = /Run\s*No\.?:\s*(\d[\d.]*)/i.exec(body)?.[1];
  if (!runNoRaw) return null;

  const dateLine = labelValue(body, /\bDate:\s*(.+)/i);
  const date = dateLine ? resolveRunDate(dateLine, publishDate) : null;
  if (!date) return null;

  // Madrid Time lines read "<12h> – <24h>h" (e.g. "7:30pm – 19:30h"). Prefer
  // the h-suffixed 24-hour value so a colon'd 12-hour prefix can't win; fall
  // back to the first HH:MM for irregular lines that omit the "h" marker.
  const timeLine = labelValue(body, /\bTime:\s*(.+)/i) ?? "";
  const hhmm =
    /(\d{1,2}):(\d{2})\s*h/i.exec(timeLine) ?? /(\d{1,2}):(\d{2})/.exec(timeLine);
  const startTime = hhmm
    ? `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`
    : undefined;

  const location = labelValue(body, /\bLocation:\s*(.+)/i);

  // Hares: split on & / , , sort for fingerprint stability, rejoin.
  const haresRaw = labelValue(body, /\bHares?:\s*(.+)/i);
  const hares = haresRaw
    ? haresRaw
        .split(/[&,]/)
        .map((h) => h.trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))
        .join(", ")
    : undefined;

  const coords = parseMadridGps(labelValue(body, /\bGPS:\s*(.+)/i));

  // Google Maps short link — newer posts use maps.app.goo.gl, older posts use
  // the legacy goo.gl/maps form. Search the whole body (the link sits on the
  // "Google Maps:" line on newer posts, the "GPS:" line on some older ones).
  const locationUrl =
    /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps)\/\S+/.exec(body)?.[0];

  // Theme carried in description; title left undefined so merge.ts synthesizes
  // "Madrid H3 Trail #N" (never let a stylized fragment become the title).
  const theme = parseMadridTheme(postTitle);

  return {
    date,
    kennelTags: ["madrid-h3"],
    runNumber: Math.floor(Number.parseFloat(runNoRaw)),
    title: undefined,
    hares,
    location,
    startTime,
    latitude: coords?.lat,
    longitude: coords?.lng,
    locationUrl,
    sourceUrl: url,
    description: theme,
  };
}

/**
 * Madrid HHH WordPress Trail Directions scraper.
 *
 * Madrid Hash House Harriers (est. 1984) publishes one run per WordPress post
 * under the "Run Directions" category, with every datum cleanly labeled in the
 * post body. Uses the self-hosted WordPress REST API (the site is static /
 * server-rendered — no browser render needed). Single fetch path, fail-loud:
 * a brand-new source has no fill-rate baseline, so a body-format drift must
 * surface as an error rather than scrape "successfully" with no events.
 */
export class MadridHashAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_BASE_URL;
    const days = options?.days ?? source.scrapeDays ?? 365;

    const wpResult = await fetchWordPressPosts(baseUrl, FORWARD_PER_PAGE);
    if (wpResult.error) {
      // Fail loud — no HTML fallback (the REST API is the canonical surface).
      return { events: [], errors: [wpResult.error.message] };
    }

    const events: RawEventData[] = [];
    for (const post of wpResult.posts) {
      const $ = cheerio.load(post.content);
      // Insert newlines at block boundaries so labels don't run together.
      $("p, br, h1, h2, h3, h4").before("\n");
      const body = $.text();
      const event = parseMadridRunBody(body, post.title, post.url, post.date);
      if (event) events.push(event);
    }

    const errors: string[] = [];
    // Fail-loud guard: posts fetched but nothing parsed ⇒ body-format drift.
    if (wpResult.posts.length > 0 && events.length === 0) {
      errors.push(
        `Madrid HHH: fetched ${wpResult.posts.length} posts but parsed 0 run events — body format may have changed.`,
      );
    }

    return applyDateWindow(
      {
        events,
        errors,
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
