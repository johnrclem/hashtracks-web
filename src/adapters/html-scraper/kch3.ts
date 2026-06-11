/**
 * Kansas City Hash House Harriers (KCH3) WordPress Trail Scraper
 *
 * Scrapes kansascityh3.com for trail announcements via the WordPress REST API.
 * Post titles contain dates like "14 March Snake Saturday Trail" or
 * "21 March 2026 SHHHHHHH Trail". The body contains labeled fields:
 * Meetup/Meet Up, Hash Cash, Hare, Location.
 *
 * If a post title contains "PNH3" or "Pearl Necklace", the event is tagged
 * as the sister kennel `pnh3` instead of `kch3`.
 *
 * Uses fetchWordPressPosts() from the shared WordPress API utility.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { fetchAllWordPressPosts, type WordPressPost } from "../wordpress-api";
import {
  applyDateWindow,
  buildDateWindow,
  chronoParseDate,
  cleanLocationName,
  htmlToNewlineText,
  parsePublishDate,
} from "../utils";

/** Default start time when the meetup line is missing or unparseable. */
const DEFAULT_START_TIME = "14:00";

/**
 * Parse a time string from KCH3 post body.
 *
 * Two-step parse so a bare hour like "2:00 at: Fox & Hound" doesn't get the
 * `a` in `at` interpreted as the AM marker (#1369):
 *   1. Capture the leading H or H:MM token.
 *   2. Look for an explicit AM/PM marker immediately adjacent to it.
 *
 * When the source omits the AM/PM marker entirely, default to PM (hash
 * convention — trails are afternoon events). Explicit AM tokens are honored.
 *
 * Returns "HH:MM" in 24-hour format, or DEFAULT_START_TIME when no hour is
 * parseable.
 */
export function parseKCH3Time(timeStr?: string): string {
  if (!timeStr) return DEFAULT_START_TIME;
  const t = timeStr.trim();

  // Find the first hour token anywhere in the string — the meetup-line
  // capture can include filler text like "at 6 p.m.", "the trail starts at
  // 2:00", or "2:00 at: Fox & Hound". Anchoring to `^` would mis-fire on
  // any post that doesn't begin with a digit (codex P1 on PR #1382).
  const hourMatch = /(\d{1,2})(?::(\d{2}))?/.exec(t);
  if (!hourMatch) return DEFAULT_START_TIME;
  let hours = Number.parseInt(hourMatch[1], 10);
  const minutes = hourMatch[2] ?? "00";
  if (hours < 0 || hours > 23) return DEFAULT_START_TIME;
  // KCH3 occasionally posts joke times like "Meetup: 1:69" (#1874).
  // Reject minutes outside 00–59 so downstream UTC composition stays valid.
  if (Number.parseInt(minutes, 10) > 59) return DEFAULT_START_TIME;

  // `\b` after `m` / lone `a`/`p` blocks matches like the `a` in `at`
  // (next char is `t` — a word char — so no word boundary).
  const rest = t.slice((hourMatch.index ?? 0) + hourMatch[0].length);
  const ampmMatch = /^\s*(a\.m\.?|p\.m\.?|am\b|pm\b|a\b|p\b)/i.exec(rest);

  if (ampmMatch) {
    const ampm = ampmMatch[1][0].toLowerCase();
    if (ampm === "p" && hours !== 12) hours += 12;
    if (ampm === "a" && hours === 12) hours = 0;
  } else if (hours < 12) {
    hours += 12;
  }

  return `${hours.toString().padStart(2, "0")}:${minutes}`;
}

/**
 * Drop a leading parenthetical *label* from a captured location — but only when
 * the parenthetical is immediately followed (after spaces) by a colon, i.e. it
 * was a "Location (label): venue" annotation. A parenthetical that is part of
 * the venue itself ("(near the fountain) Central Park", no following colon) is
 * left intact. Procedural (no regex) so the location-matching regexes stay
 * simple and linear (#2019).
 */
export function stripLeadingParenLabel(value: string): string {
  if (!value.startsWith("(")) return value;
  const close = value.indexOf(")");
  if (close === -1) return value;
  let i = close + 1;
  while (i < value.length && (value[i] === " " || value[i] === "\t")) i++;
  if (value[i] !== ":") return value; // not a label — leave the venue paren alone
  i++; // skip the colon
  while (i < value.length && (value[i] === " " || value[i] === "\t")) i++;
  return value.slice(i).trim();
}

/**
 * Parse labeled fields from a KCH3 post body.
 *
 * Extracts meetup time, hash cash, hare(s), and location from the free-text
 * body. Fields are labeled with "Meetup:", "Hash Cash:", "Hare:", "Location:".
 * Some posts use "Meet Up" (two words) or "Meet Up X:XX at:" format.
 */
export function parseKCH3Body(text: string): {
  time?: string;
  hashCash?: string;
  hares?: string;
  location?: string;
  description?: string;
} {
  // Time: "Meetup: 2 p.m." or "Meet Up: 12:00p" or "Meetup 2 p.m." or "Meet Up 2:00 at:"
  const meetupMatch = /Meet\s*[Uu]p:?\s*(.+?)(?=\n|$)/i.exec(text);
  const time = meetupMatch ? meetupMatch[1].trim() : undefined;

  // Hash Cash: "$5" or "5 dolla"
  const cashMatch = /Hash\s*Cash:?\s*(.+?)(?=\n|$)/i.exec(text);
  const hashCash = cashMatch ? cashMatch[1].trim() : undefined;

  // Hare(s): "Hare: Sow Cow Me Maybe" or "Hare(s): ..."
  const hareMatch = /Hares?\s*(?:\([^)]*\))?\s*:?\s*(.+?)(?=\n|$)/i.exec(text);
  const hares = hareMatch ? hareMatch[1].trim() : undefined;

  // Location: "Location: Macken Park…", "Location KC Bier Company…" (no colon),
  // "Start Location: Hidden Valley Park…", or address at "Start:" / "Where:".
  // Match each label only at the START of a line and capture same-line text.
  // The old unanchored `:?\s*` form matched the bare word in prose (e.g. "just
  // in time for the start of the winter Olympics") AND let `\s*` span the
  // newline into the next line's cost/time text (#2110 follow-up).
  //   - The Location label keeps an OPTIONAL colon (the site often writes
  //     "Location <venue>" / "Location <venue>" with no colon) and accepts an
  //     optional "Start " prefix; stripLeadingParenLabel still handles the
  //     "Location (also prelube): venue" shape (#2019).
  //   - Bare "Start" and "Where" REQUIRE the colon, which is what rejects
  //     "Start Time 3 p.m." and "Start @ Private Home:" (address on the next
  //     line) without swallowing them as a venue.
  const locMatch =
    /^[ \t]*(?:Start[ \t]+)?Location[ \t]*:?[ \t]*(.+)$/im.exec(text) ||
    /^[ \t]*Where[ \t]*:[ \t]*(.+)$/im.exec(text) ||
    /^[ \t]*Start[ \t]*:[ \t]*(.+)$/im.exec(text);
  // Strip a parenthetical label that precedes the colon — e.g.
  // "Location (also prelube and on-after): Helen's J.A.D. ..." captures
  // "(also prelube and on-after): Helen's …"; drop the leading label so it
  // doesn't leak into the venue (#2019). Done procedurally to keep the regexes
  // above unchanged (and linear — no ReDoS-shape groups).
  const location = locMatch ? stripLeadingParenLabel(locMatch[1].trim()) : undefined;

  return { time, hashCash, hares, location };
}

/**
 * Determine kennel tag from post title.
 * Returns "pnh3" for the ladies' sister kennel, "kch3" otherwise.
 *
 * PNH3 (Pearl Necklace H3) trails post to the same global KCH3 feed and are
 * titled either "Pearl Necklace …" or, more often, "Ladies Only …" /
 * "Ladies-Only …" (#2110). KCH3's own trails never carry the "Ladies Only"
 * marker, so matching it is a safe per-kennel discriminator. "Ladies" alone is
 * deliberately NOT matched — it appears in KCH3 trail themes.
 */
export function resolveKennelTag(title: string): string {
  if (/PNH3|Pearl\s*Necklace|Ladies[\s-]*Only/i.test(title)) return "pnh3";
  return "kch3";
}

/**
 * Process a single WordPress post into a RawEventData.
 * Returns null if the post cannot be parsed into a valid event.
 *
 * `publishDate` (ISO timestamp from the WordPress REST API) anchors the year
 * when the title omits it. Without an anchor, chrono `forwardDate` would roll
 * year-less titles past the current date — "28 February" posted in 2026
 * resolves to 2027 instead of 2026 (#1368). Anchoring on the post's publish
 * date lets chrono pick the year nearest to publication.
 */
export function processKCH3Post(
  titleText: string,
  bodyText: string,
  postUrl: string,
  publishDate?: string,
): RawEventData | null {
  // `parsePublishDate` returns undefined for missing or malformed input,
  // sidestepping a silent parse failure when chrono is handed `Date(NaN)`.
  const refDate = parsePublishDate(publishDate);
  const dateStr = chronoParseDate(titleText, "en-US", refDate);
  if (!dateStr) return null;

  const body = parseKCH3Body(bodyText);
  const startTime = parseKCH3Time(body.time);
  const kennelTag = resolveKennelTag(titleText);

  const trailName = titleText
    .replace(/^\d{1,2}\s+\w+\s*(?:\d{4}\s*)?/i, "")
    .trim() || titleText;

  // Normalize the venue through the shared cleaner (strips residual labels,
  // map anchors, qualifiers). `null` = explicit clear; preserve `undefined`
  // when the post had no Location field so the merge UPDATE path keeps any
  // existing value.
  const location =
    body.location === undefined ? undefined : cleanLocationName(body.location);

  return {
    date: dateStr,
    kennelTags: [kennelTag],
    title: trailName,
    hares: body.hares,
    location,
    startTime,
    sourceUrl: postUrl,
    description: body.hashCash ? `Hash Cash: ${body.hashCash}` : undefined,
  };
}

/**
 * KCH3 WordPress Trail Scraper
 *
 * Scrapes kansascityh3.com for trail announcements via the WordPress REST API.
 * Each post title contains the date and trail name. Body contains structured
 * fields: Meetup time, Hash Cash, Hare, Location.
 */
export class KCH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const baseUrl = source.url || "https://kansascityh3.com/";
    const days = options?.days ?? source.scrapeDays ?? 365;

    // Paginate the shared KCH3 feed instead of grabbing only the latest 10
    // posts. PNH3 ("Ladies Only") trails are infrequent and posted to the same
    // global feed, so a single page drops them within ~2 weeks (#2110). Stop
    // once a page falls entirely outside the window so a recurring 365-day
    // scrape walks ~1-2 pages; a wide one-shot `days` walks back to the archive
    // root. Returning the full window keeps reconcile safe.
    let posts: WordPressPost[];
    try {
      posts = await fetchAllWordPressPosts(baseUrl, {
        perPage: 100,
        maxPages: 50,
        stopBefore: buildDateWindow(days).minDate,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url: baseUrl, message }] },
      };
    }

    const events: RawEventData[] = [];

    for (const post of posts) {
      const bodyText = htmlToNewlineText(post.content);
      const event = processKCH3Post(post.title, bodyText, post.url, post.date);
      if (event) events.push(event);
    }

    return applyDateWindow({
      events,
      errors: [],
      diagnosticContext: {
        fetchMethod: "wordpress-api-paginated",
        postsFound: posts.length,
      },
    }, days);
  }
}
