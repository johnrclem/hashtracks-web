import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { fetchBloggerPosts } from "../blogger-api";
import { applyDateWindow, applyWeekdayShift, extractUkPostcode, MONTHS, parse12HourTime, stripHtmlTags, WEEKDAY_NAMES } from "../utils";
import { inferYearClosestToPublish } from "../year-inference";

const KENNEL_TAG = "tvh3";
const DEFAULT_BLOG_URL = "https://www.teignvalleyh3.com/";
const DEFAULT_START_TIME = "19:15";

/**
 * Announcement run line: `Run #2153 Monday 2nd November Circle up 7:15 pm from …`.
 * Captures run number, weekday word, day, month word. The weekday/month words are
 * validated through WEEKDAY_NAMES / MONTHS lookups (no name alternation — keeps
 * Sonar regex complexity low). "Circle up" must follow the date (checked with
 * string ops), which is what separates announcements from "The Words" recaps
 * (`RUN #2150 Monday 12th October From The Bell Inn … Who was there:`).
 */
const RUN_LINE_RE = /\bRun\s?#\s?(\d{3,5}) ([a-z]+) (\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\b/i;

const WHAT3WORDS_RE = /(?:what3words|w3w):? ?\/{0,3}([a-z]+\.[a-z]+\.[a-z]+)/i;

/** `Circle up 7:15 pm ` / `Circle up at 7.15pm ` prefix ahead of the venue. */
const CIRCLE_UP_RE = /^circle up (?:at )?(?:\d{1,2}[:.]\d{2} ?(?:am|pm)? ?)?/i;

const RFC_WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Longest hare clause we accept; longer "with …" text is prose, not a name list. */
const MAX_HARE_LENGTH = 40;
const MAX_HARE_WORDS = 7;

/** Longer "venues" are run-on prose with no postcode/hare boundary — dropped. */
const MAX_VENUE_LENGTH = 120;

/** Max distance from the run-line date to "Circle up" (allows a short event label). */
const CIRCLE_UP_REACH = 60;

/** How far past the run line a venue's postcode may sit. */
const VENUE_WINDOW = 160;

export interface ParsedTvh3Post {
  runNumber: number;
  date: string; // YYYY-MM-DD
  startTime: string;
  location?: string;
  description?: string;
  hares?: string;
  sourceUrl: string;
}

/** End of the first sentence in `text` (". ", "! ", or end of string). */
function sentenceEnd(text: string): number {
  let end = text.length;
  for (const terminator of [". ", "! ", "? "]) {
    const i = text.indexOf(terminator);
    if (i !== -1 && i < end) end = i;
  }
  return end;
}

function trimPunctuation(value: string): string {
  let out = value.trim();
  while (out.length > 0 && ",.;:!-".includes(out.at(-1) ?? "")) out = out.slice(0, -1).trimEnd();
  return out;
}

/** Start of an on-down label (". OD ", "ON DOWN", "on-down", "OnDown") in any case/spacing, or -1. */
function onDownIndex(text: string): number {
  const lower = text.toLowerCase();
  let best = -1;
  for (const label of [". od ", "on down", "on-down", "ondown"]) {
    const i = lower.indexOf(label);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/**
 * Venue: the text after `Circle up <time>` (minus a leading "from" / "just out
 * of" / "at"), ending at the UK postcode when one sits inside the first clause,
 * else at " with " / the sentence end. Returns the venue and the remaining
 * text (where the hare clause lives).
 */
function splitVenue(afterRunLine: string): { venue?: string; rest: string } {
  let after = afterRunLine.replace(CIRCLE_UP_RE, "");
  const lower = after.toLowerCase();
  if (lower.startsWith("sharp ")) after = after.slice(6);
  for (const marker of ["from ", "just out of ", "at "]) {
    if (after.toLowerCase().startsWith(marker)) {
      after = after.slice(marker.length);
      break;
    }
  }

  // A postcode ahead of the hare clause ends the venue (venues often contain
  // ". " abbreviations — "Upside Bar Co. Victoria Street"); otherwise stop at
  // " with " or the first sentence end.
  const lowerAfter = after.toLowerCase();
  const withIdx = lowerAfter.indexOf(" with ");
  let postcodeWindow = after.slice(0, withIdx === -1 ? VENUE_WINDOW : withIdx);
  // The on-down pub's postcode is not the start venue ("… car park. OD the Bishop Lacy Inn … TQ13 0HY").
  const odIdx = postcodeWindow.indexOf(". OD ");
  // The on-down pub's postcode is not the start venue ("… car park. OD the Bishop Lacy Inn … TQ13 0HY",
  // "… at Manaton.ON DOWN from the Kestor Inn TQ13 9UF").
  const odIdx = onDownIndex(postcodeWindow);
  if (odIdx !== -1) postcodeWindow = postcodeWindow.slice(0, odIdx);
  const postcode = extractUkPostcode(postcodeWindow);
  const clauseEnd = withIdx === -1 ? after.length : withIdx;
  const end = postcode
    ? postcodeWindow.toUpperCase().indexOf(postcode) + postcode.length
    : Math.min(clauseEnd, sentenceEnd(after));
    : Math.min(clauseEnd, sentenceEnd(after), odIdx === -1 ? after.length : odIdx);

  let venue = trimPunctuation(after.slice(0, end));
  if (venue.startsWith("the ")) venue = venue.slice(4);
  if (venue.length > MAX_VENUE_LENGTH) return { rest: after.slice(end) };
  return { venue: venue || undefined, rest: after.slice(end) };
}

/** Cut a hare clause at the first prose connector (" who ", " for our "). */
function cutProse(names: string): string {
  let out = names;
  for (const connector of [" who ", " for our "]) {
    const i = out.toLowerCase().indexOf(connector);
    if (i !== -1) out = out.slice(0, i);
  }
  return out;
}

/**
 * Hares: `with [hare(s)] <names>` (or a `Hare: <names>` label) found near the
 * venue, up to the sentence end. Prose-guarded: rejects lowercase "the …"
 * clauses ("with the on down at …") and anything longer than a name list.
 */
function parseHares(rest: string): string | undefined {
  const window = rest.slice(0, 160);
  const lower = window.toLowerCase();
  let idx = lower.indexOf("with ");
  let skip = 5;
  if (idx === -1) {
    idx = lower.indexOf("hare: ");
    skip = 6;
  }
  if (idx === -1) return undefined;
  let names = window.slice(idx + skip);
  names = trimPunctuation(cutProse(names.slice(0, sentenceEnd(names))));
  const head = names.toLowerCase();
  if (head.startsWith("hares ")) names = names.slice(6);
  else if (head.startsWith("hare ")) names = names.slice(5);
  else if (head.startsWith("our ")) names = names.slice(4);
  names = names.trim();
  if (!names || names.startsWith("the ") || names.length > MAX_HARE_LENGTH) return undefined;
  if (names.split(" ").length > MAX_HARE_WORDS) return undefined;
  return names;
}

/**
 * Parse one Teign Valley H3 Blogger post. Returns null for anything that is not
 * a run announcement ("The Words" recaps, socials, "awaiting words" stubs).
 * Exported for the unit tests and the one-shot history backfill.
 */
export function parseTvh3Post(body: string, publishedIso: string, url: string): ParsedTvh3Post | null {
  const flat = body.replaceAll(/\s+/g, " ");
  const match = RUN_LINE_RE.exec(flat);
  if (!match) return null;

  // "Circle up" follows the date directly, or after a short event label
  // ("RUN #2000 Monday 18th December: TVH Special Christmas Draw, circle up at
  // 7:15 pm from …"). Recaps never carry it this close to the run line.
  const afterDate = flat.slice(match.index + match[0].length);
  const circleIdx = afterDate.slice(0, CIRCLE_UP_REACH).toLowerCase().indexOf("circle up");
  if (circleIdx === -1) return null;
  const rest = afterDate.slice(circleIdx);
  const statedWeekday = match[2].toUpperCase();
  if (WEEKDAY_NAMES[statedWeekday] === undefined) return null;

  const runNumber = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[3], 10);
  const month = MONTHS[match[4].toLowerCase()];
  if (!month) return null;
  const inferred = inferYearClosestToPublish(day, month, publishedIso);
  if (!inferred) return null;
  // Announcements are copy-edited from earlier ones and sometimes keep a stale
  // day number ("#2100 Monday 28th October" in 2025, when the Monday was the
  // 27th). The weekday is the reliable half: snap to the nearest date that
  // falls on the stated weekday (shift of at most ±3 days).
  const actualDow = new Date(`${inferred}T12:00:00Z`).getUTCDay();
  const date = applyWeekdayShift(inferred, undefined, { from: RFC_WEEKDAYS[actualDow], to: statedWeekday }).date;

  const firstSentenceEnd = sentenceEnd(rest);
  const startTime = parse12HourTime(rest.slice(0, Math.min(firstSentenceEnd, 40))) ?? DEFAULT_START_TIME;
  const { venue, rest: afterVenue } = splitVenue(rest);
  const w3w = WHAT3WORDS_RE.exec(flat);

  return {
    runNumber,
    date,
    startTime,
    location: venue,
    // what3words is not a Maps URL — never set locationUrl from it (repo convention);
    // surface it in the description instead.
    description: w3w ? `what3words: ///${w3w[1].toLowerCase()}` : undefined,
    hares: parseHares(afterVenue),
    sourceUrl: url,
  };
}

/**
 * Teign Valley H3 (Torbay / South Devon) — weekly Monday 19:15 runs announced
 * on a custom-domain Blogger blog (teignvalleyh3.com), read via the Blogger
 * API v3. Only run-announcement posts become events; recaps are skipped.
 * Recent window only — `Source.config.upcomingOnly` keeps reconcile from
 * cancelling runs whose announcement has scrolled out of the fetch.
 */
export class TeignValleyH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const baseUrl = source.url || DEFAULT_BLOG_URL;
    const days = options?.days ?? source.scrapeDays ?? 365;

    // ~2 posts/week (announcement + recap): 30 posts ≈ 3–4 months of runs.
    const bloggerResult = await fetchBloggerPosts(baseUrl, 30);

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
      const parsed = parseTvh3Post(stripHtmlTags(post.content, "\n"), post.published, post.url);
      if (!parsed) continue;
      events.push({
        date: parsed.date,
        kennelTags: [KENNEL_TAG],
        runNumber: parsed.runNumber,
        startTime: parsed.startTime,
        location: parsed.location,
        description: parsed.description,
        hares: parsed.hares,
        sourceUrl: parsed.sourceUrl,
      });
    }

    // Fail-loud: brand-new source, no fill-rate baseline — a body-format drift
    // must surface (and suppress reconcile) rather than pass as "0 events".
    if (events.length === 0 && bloggerResult.posts.length > 0) {
      errors.push(
        `Teign Valley H3: fetched ${bloggerResult.posts.length} posts but parsed 0 run announcements — post format may have changed`,
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
