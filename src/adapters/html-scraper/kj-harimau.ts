import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import {
  applyDateWindow,
  decodeEntities,
  normalizeHaresField,
  parse12HourTime,
  stripHtmlTags,
} from "../utils";

/**
 * Kelana Jaya Harimau Hash House Harriers (KJ Harimau) adapter.
 *
 * khhhkj.blogspot.com is a Blogger-hosted blog that mixes weekly run
 * announcements with birthday/wedding/holiday greetings. Run posts have a
 * very specific title shape:
 *
 *   "Run#:1548, 14/04/2026, Hare: Silver Hai Ho, Runsite: Radio Cafe, Botanic Klang"
 *
 * and a body that follows a consistent labeled template:
 *
 *   *Kelab Hash House Harimau Kelana Jaya*
 *   Run#: 1548
 *   Date: 14/04/26,
 *   Time: 6:00 pm
 *   Hare: Silver Hai Ho - https://shorturl.at/9SSG7
 *   Runsite: Radio Cafe, Botanic Klang
 *   GPS: 2.9874534,101.4512081
 *   Maps: https://maps.app.goo.gl/...
 *   Waze: https://waze.com/ul/...
 *   Guest Fee: RM 60
 *
 * Non-run posts (birthdays, weddings, holiday greetings) are filtered by
 * title — only posts matching `/^Run#?:?\s*\d+/i` are kept.
 *
 * Weekly Tuesday 18:00. Founded 20 August 1996.
 */

const KENNEL_TAG = "kj-harimau";
const DEFAULT_START_TIME = "18:00"; // weekly Tuesday 6 PM
const RUN_TITLE_RE = /^\s*Run\s*#?\s*:?\s*(\d+)/i;

/**
 * Parse a date token like "14/04/2026", "14/04/26", or "14-04-2026" into
 * "YYYY-MM-DD" (DD/MM/YYYY order — KJ Harimau is Malaysian, not US).
 * Exported for unit testing.
 */
export function parseKjHarimauDate(raw: string): string | null {
  const m = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(raw);
  if (!m) return null;
  const day = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  let year = Number.parseInt(m[3], 10);
  if (year < 100) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Extract labeled fields from a KJ Harimau post body text. Body fields can
 * be on one line or multiple lines; we use anchor-based regexes that stop
 * at the next known label to stay robust against formatting variation.
 *
 * Exported for unit testing.
 */
export function parseKjHarimauBody(bodyText: string): {
  runNumber?: number;
  date?: string;
  startTime?: string;
  hare?: string;
  runsite?: string;
  latitude?: number;
  longitude?: number;
  mapsUrl?: string;
  wazeUrl?: string;
  guestFee?: string;
} {
  const labels = String.raw`(?:Run\s*#|Date|Time|Hare|Runsite|GPS|Maps|Waze|Guest\s*Fee|Birthdays|Wedding)`;
  const stop = `(?=\\n|${labels}\\s*:|$)`;
  const text = bodyText.replace(/\r/g, "");

  // A bare label captured as a value means the previous field was empty and
  // the lookahead consumed too much (the #1446 "Maps:" leak); reject it.
  const labelOnlyRe = /^(?:Run\s*#|Date|Time|Hare|Runsite|GPS|Maps|Waze|Guest\s*Fee|Birthdays|Wedding)\s*:?$/i;

  // Allow the value either on the same line OR on the next line. `\S` forces a
  // non-whitespace first char so a doubly-blank field (`Runsite:\n\nMaps:`)
  // can't latch onto the next label.
  const grab = (label: string): string | undefined => {
    // nosemgrep: detect-non-literal-regexp — `label` is a hard-coded literal from the constant above, not user input (mirrors hare-extraction.ts suppression)
    // eslint-disable-next-line -- security/detect-non-literal-regexp + security-node/non-literal-reg-expr (Codacy ESLint plugins not loaded locally); `label` is a hard-coded literal
    const re = new RegExp(`${label}\\s*:[ \\t]*(?:\\n[ \\t]*)?(\\S.*?)${stop}`, "i"); // NOSONAR nosemgrep
    const m = re.exec(text);
    if (!m) return undefined;
    const value = m[1].trim().replace(/\s+/g, " ");
    if (!value || labelOnlyRe.test(value)) return undefined;
    return value;
  };

  const runNumRaw = grab("Run\\s*#");
  const runNumber = runNumRaw ? Number.parseInt(runNumRaw.replace(/\D/g, ""), 10) : undefined;

  const dateRaw = grab("Date");
  const date = dateRaw ? parseKjHarimauDate(dateRaw) ?? undefined : undefined;

  const timeRaw = grab("Time");
  const startTime = timeRaw
    ? parse12HourTime(timeRaw.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm"))
    : undefined;

  let hare = grab("Hare");
  if (hare) {
    // Drop trailing " - https://..." shorturl
    hare = hare.replace(/\s*-\s*https?:\/\/\S+.*$/, "").trim();
    if (!hare) hare = undefined;
  }

  const runsite = grab("Runsite");
  const gpsRaw = grab("GPS");
  let latitude: number | undefined;
  let longitude: number | undefined;
  if (gpsRaw) {
    const m = /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/.exec(gpsRaw);
    if (m) {
      latitude = Number.parseFloat(m[1]);
      longitude = Number.parseFloat(m[2]);
    }
  }

  const mapsRaw = grab("Maps");
  const mapsUrl = mapsRaw && /^https?:\/\//.test(mapsRaw) ? mapsRaw.split(/\s+/)[0] : undefined;

  const wazeRaw = grab("Waze");
  const wazeUrl = wazeRaw && /^https?:\/\//.test(wazeRaw) ? wazeRaw.split(/\s+/)[0] : undefined;

  const guestFee = grab("Guest\\s*Fee");

  return { runNumber, date, startTime, hare, runsite, latitude, longitude, mapsUrl, wazeUrl, guestFee };
}

/**
 * Parse an event from a raw title (fallback path when the body is
 * incomplete). Exported for unit testing.
 */
export function parseKjHarimauTitle(title: string): { runNumber?: number; date?: string; hare?: string; runsite?: string } {
  const decoded = decodeEntities(title);
  const runMatch = RUN_TITLE_RE.exec(decoded);
  const runNumber = runMatch ? Number.parseInt(runMatch[1], 10) : undefined;

  // "Run#:1548, 14/04/2026, Hare: X, Runsite: Y"
  const date = parseKjHarimauDate(decoded);

  const hareMatch = /Hare\s*:\s*([^,]+?)(?:,|$)/i.exec(decoded);
  const hare = hareMatch?.[1].trim();

  const runsiteMatch = /Runsite\s*:\s*(.+?)\s*$/i.exec(decoded);
  const runsite = runsiteMatch?.[1].trim();

  return { runNumber, date: date ?? undefined, hare, runsite };
}

/** Rank a candidate post by how many bug-relevant fields it filled in. The
 *  #1446 bug class is empty/leaked `location`, so location and the
 *  coordinate-equivalent fields (maps URL, GPS pair) outweigh hares/Waze/fee. */
function scoreCompleteness(
  body: ReturnType<typeof parseKjHarimauBody>,
  location: string | undefined,
  hares: string | undefined,
): number {
  return (
    (location ? 4 : 0) +
    (body.mapsUrl ? 2 : 0) +
    (body.latitude !== undefined && body.longitude !== undefined ? 2 : 0) +
    (hares ? 1 : 0) +
    (body.wazeUrl ? 1 : 0) +
    (body.guestFee ? 1 : 0)
  );
}

type BloggerPost = { title: string; content: string; url: string };
type Candidate = { event: RawEventData; score: number };

/** Build a RawEventData candidate (with completeness score) from a single
 *  Blogger post. Returns `{ skip: true }` when the post is a non-run notice
 *  (birthday, holiday greeting) or `{ error }` when the date can't be parsed. */
function buildKjCandidate(post: BloggerPost):
  | { skip: true }
  | { error: { titleDecoded: string } }
  | { candidate: Candidate; key: string } {
  const titleDecoded = decodeEntities(post.title);
  if (!RUN_TITLE_RE.test(titleDecoded)) return { skip: true };

  const bodyText = stripHtmlTags(post.content, "\n");
  const body = parseKjHarimauBody(bodyText);
  const titleFields = parseKjHarimauTitle(titleDecoded);

  const date = body.date ?? titleFields.date;
  if (!date) return { error: { titleDecoded } };

  const runNumber = body.runNumber ?? titleFields.runNumber;
  const hares = normalizeHaresField(body.hare ?? titleFields.hare);
  const location = body.runsite ?? titleFields.runsite;

  const externalLinks = body.wazeUrl
    ? [{ url: body.wazeUrl, label: "Waze" }]
    : undefined;

  const event: RawEventData = {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    hares,
    location,
    locationUrl: body.mapsUrl,
    latitude: body.latitude,
    longitude: body.longitude,
    startTime: body.startTime ?? DEFAULT_START_TIME,
    sourceUrl: post.url,
    description: body.guestFee ? `Guest Fee: ${body.guestFee}` : undefined,
    externalLinks,
  };

  return {
    candidate: { event, score: scoreCompleteness(body, location, hares) },
    key: `${date}|${runNumber ?? ""}`,
  };
}

export interface KjHarimauFetchOptions {
  /** Reconcile/scrape window in days, forwarded to applyDateWindow. */
  days?: number;
  /** Blogger API page size. Defaults to fetchBloggerPosts' own default (25). Backfill scripts pass higher. */
  maxResults?: number;
}

export class KjHarimauAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: KjHarimauFetchOptions,
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://khhhkj.blogspot.com";
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};

    // maxResults defaults to fetchBloggerPosts' own default (25) when omitted.
    // Backfill scripts pass a higher value to walk the visible archive.
    const bloggerResult = await fetchBloggerPosts(baseUrl, options?.maxResults);
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

    // KJ Harimau occasionally republishes the same run as a second Blogger
    // post — sometimes the FIRST post seen still has an empty `Runsite:` /
    // `Maps:`. Pick the most-complete candidate per (date, runNumber). (#1446)
    const groups = new Map<string, Candidate>();
    let duplicatesSkipped = 0;
    let filteredOut = 0;
    for (let i = 0; i < bloggerResult.posts.length; i++) {
      const result = buildKjCandidate(bloggerResult.posts[i]);
      if ("skip" in result) {
        filteredOut++;
        continue;
      }
      if ("error" in result) {
        errors.push(
          `KJ Harimau post "${result.error.titleDecoded.slice(0, 80)}" has no parseable date`,
        );
        errorDetails.parse = [
          ...(errorDetails.parse ?? []),
          {
            row: i,
            section: "post",
            field: "date",
            error: "No parseable date",
            rawText: `Title: ${result.error.titleDecoded}`.slice(0, 500),
          },
        ];
        continue;
      }
      const existing = groups.get(result.key);
      if (existing) {
        duplicatesSkipped++;
        if (result.candidate.score > existing.score) groups.set(result.key, result.candidate);
      } else {
        groups.set(result.key, result.candidate);
      }
    }

    const events: RawEventData[] = Array.from(groups.values()).map((c) => c.event);

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
          duplicatesSkipped,
          eventsParsed: events.length,
          fetchDurationMs: bloggerResult.fetchDurationMs,
        },
      },
      days,
    );
  }
}
