import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { stripHtmlTags, decodeEntities, googleMapsSearchUrl, MONTHS, extractHashRunNumber } from "../utils";
import { safeFetch } from "../safe-fetch";

/**
 * ONH3 — Original Nairobi Hash House Harriers (Nairobi, Kenya).
 * HashTracks' first Africa kennel.
 *
 * Source: public WordPress.com blog at onh3.wordpress.com, read through the
 * WordPress.com public REST API (mirrors SWH3Adapter). Two event shapes:
 *
 *  1. Per-post run announcements — labeled body fields
 *     ("Date: 30 March 2026 Hare: ... Venue: ... Location: <maps url>").
 *     Each post also bundles a "Hash Trash" recap of the PREVIOUS run; that
 *     block is stripped before parsing so we don't harvest the wrong date.
 *  2. Annual "Hareline YYYY" master posts — a 51-row <table> of every Monday
 *     (Run nr | Day | Date DD/MM/YYYY | Hare | Venue | Location). Routed by
 *     title; backfills runs not yet announced as individual posts. The merge
 *     pipeline dedupes table rows against per-post events by kennel + date.
 *
 * Standalone "Hash Trash" recap posts and non-run socials are skipped.
 */

const WPCOM_API = "https://public-api.wordpress.com/wp/v2/sites/onh3.wordpress.com";
const KENNEL_TAG = "onh3";
const DEFAULT_START_TIME = "17:45"; // 5:45 PM per kennel convention (registration from 5:00 PM)
const MAX_PAGES = 5; // 5 × 100 = 500 posts; the blog currently holds ~34

// "Run 1326", "Run #1068", "Run: #1068". \D{0,3} (not \s*#?\s*) avoids the
// whitespace-bracketed-quantifier shape SonarCloud flags as ReDoS (S5852).
const RUN_NUMBER_RE = /Run\b\D{0,3}(\d{3,4})/i;
const DMY_TEXT_RE = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/; // "30 March 2026", "16 Mar 2019"
const DMY_NUMERIC_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/; // "05/01/2026" (DD/MM/YYYY)
const URL_RE = /(https?:\/\/\S+)/;
const HARELINE_TITLE_RE = /^\s*hareline\s+\d{4}/i;
const HASH_TRASH_TITLE_RE = /^\s*(?:past\s+)?hash\s*trash/i;
const HASH_TRASH_SPLIT_RE = /Hash\s+Trash/i;
// Boundary scanner for the multi-pass field tokenizer (S5852-safe: no nested quantifiers).
const FIELD_LABELS_RE = /(?:Date|Hares?|Venue|Location|Time|Run)\s*:/gi;

interface WPComPost {
  id: number;
  date: string;
  link: string;
  title: { rendered: string };
  content: { rendered: string };
  categories?: number[];
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function iso(y: number, m: number, d: number): string | undefined {
  return isValidYmd(y, m, d)
    ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    : undefined;
}

/** Resolve a month name (full or abbreviated) to a 1-based number via utils.MONTHS. */
function monthNumber(word: string): number | undefined {
  const w = word.toLowerCase();
  return MONTHS[w] ?? MONTHS[w.slice(0, 3)]; // exact, then 3-letter prefix ("Sept" → "sep")
}

/** Parse "D Month YYYY" / "D Mon YYYY" text (weekday prefix tolerated by searching). */
export function parseTextDate(value: string): string | undefined {
  const m = DMY_TEXT_RE.exec(value);
  if (!m) return undefined;
  const month = monthNumber(m[2]);
  if (month === undefined) return undefined;
  return iso(parseInt(m[3], 10), month, parseInt(m[1], 10));
}

/** Parse "DD/MM/YYYY" (UK/Kenyan order — NOT US M/D/Y). */
export function parseNumericDate(value: string): string | undefined {
  const m = DMY_NUMERIC_RE.exec(value);
  if (!m) return undefined;
  return iso(parseInt(m[3], 10), parseInt(m[2], 10), parseInt(m[1], 10));
}

/**
 * Pull a labeled field's value out of the body by slicing from the label to the
 * next known label OR the next line break, whichever comes first (multi-pass
 * tokenizer — avoids backtracking). The line break matters: ONH3 puts each field
 * in its own block element and appends an unlabeled "Hash Trash" recap, so a
 * trailing field like Venue would otherwise swallow the whole write-up.
 */
export function fieldValue(text: string, label: string): string | undefined {
  const labelRe = new RegExp(`${label}\\s*:`, "i");
  const m = labelRe.exec(text);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  FIELD_LABELS_RE.lastIndex = start;
  const nextLabel = FIELD_LABELS_RE.exec(text);
  const nlIdx = text.indexOf("\n", start);
  const end = Math.min(
    nextLabel ? nextLabel.index : text.length,
    nlIdx === -1 ? text.length : nlIdx,
  );
  const value = text.slice(start, end).trim();
  return value.length > 0 ? value : undefined;
}

export function parseOnh3Title(title: string): { runNumber?: number; theme?: string } {
  const m = RUN_NUMBER_RE.exec(title);
  return { runNumber: m ? parseInt(m[1], 10) : undefined, theme: deriveTheme(title) };
}

/**
 * Derive a human theme from the title, or undefined. Leaving it undefined lets
 * merge.ts synthesize the canonical "ONH3 Trail #N" title (a theme must never
 * be a hare name or a labeled-field fragment).
 */
export function deriveTheme(title: string): string | undefined {
  const cleaned = title
    .replace(/^Monday\b.*?\|\s*/i, "") // "Monday 30 Mar 2026 | "
    .replace(/^ONH3\s+/i, "")
    .replace(RUN_NUMBER_RE, "")
    .replace(/^[\s.\-–|]+|[\s.\-–|]+$/g, "");
  if (cleaned.length === 0) return undefined;
  // A remainder carrying labeled fields ("Hare: …", "Venue: …") is not a theme.
  if (/\b(?:Hares?|Venue|Date|Location)\s*:/i.test(cleaned)) return undefined;
  return cleaned;
}

/**
 * Some posts pack the venue and a sentence of directions into one block
 * ("Community Cooker at the Planning House on Lower Kabete. A couple hundred
 * meters before…"). Keep just the venue name. Guarded so short prefixes (an
 * abbreviation like "St. Andrews") are never truncated.
 */
function cleanVenue(venue: string | undefined): string | undefined {
  if (!venue) return undefined;
  const period = venue.indexOf(". ");
  return period >= 15 ? venue.slice(0, period).trim() : venue;
}

function flatten(html: string): string {
  // Newline separator keeps block boundaries so fieldValue can stop at them;
  // collapse only intra-line whitespace (preserve the newlines).
  return decodeEntities(stripHtmlTags(html, "\n")).replace(/[^\S\n]+/g, " ");
}

/** A per-post run announcement → one event, or null if no parseable date. */
export function postToEvent(post: WPComPost): RawEventData | null {
  // Drop the embedded "Hash Trash" recap of the previous run before parsing.
  const announcement = flatten(post.content.rendered).split(HASH_TRASH_SPLIT_RE)[0];

  const dateField = fieldValue(announcement, "Date");
  const date = dateField ? parseTextDate(dateField) ?? parseNumericDate(dateField) : undefined;
  if (!date) return null;

  const { runNumber: titleRun, theme } = parseOnh3Title(post.title.rendered);
  // Body fallback uses the shared "#NNN" parser on the "Run:" field ("Run: #1068").
  const runNumber = titleRun ?? extractHashRunNumber(fieldValue(announcement, "Run"));

  const hares = fieldValue(announcement, "Hares?");
  const venue = cleanVenue(fieldValue(announcement, "Venue"));
  const locationField = fieldValue(announcement, "Location");
  const urlMatch = locationField ? URL_RE.exec(locationField) : null;
  const locationUrl =
    urlMatch?.[1] ?? (venue ? googleMapsSearchUrl(`${venue} Nairobi Kenya`) : undefined);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    title: theme,
    hares,
    location: venue,
    locationUrl,
    startTime: DEFAULT_START_TIME,
    sourceUrl: post.link,
  };
}

/** An annual "Hareline YYYY" <table> post → one event per data row. */
export function parseHarelineTable(post: WPComPost): RawEventData[] {
  const $ = cheerio.load(post.content.rendered);
  const events: RawEventData[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, td) => decodeEntities($(td).text()).replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 5) return; // malformed / spacer row

    const runNumber = /^\d{3,4}$/.test(cells[0]) ? parseInt(cells[0], 10) : undefined;
    const date = parseNumericDate(cells[2] ?? "");
    if (!date) return; // header row ("Run nr"/"Date") and blanks fall out here

    const hares = cells[3] || undefined;
    const venue = cells[4] || undefined;
    const area = cells[5] || undefined;
    const venueQuery = [venue, area].filter(Boolean).join(", ");

    events.push({
      date,
      kennelTags: [KENNEL_TAG],
      runNumber,
      hares,
      location: venue,
      locationUrl: venueQuery ? googleMapsSearchUrl(`${venueQuery} Nairobi Kenya`) : undefined,
      startTime: DEFAULT_START_TIME,
      sourceUrl: post.link,
    });
  });

  return events;
}

function eventsFromPost(post: WPComPost): RawEventData[] {
  const title = post.title.rendered;
  if (HARELINE_TITLE_RE.test(title)) return parseHarelineTable(post);
  if (HASH_TRASH_TITLE_RE.test(title)) return []; // standalone recap, not an upcoming run
  const event = postToEvent(post);
  return event ? [event] : [];
}

export class ONH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(_source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let kennelPageFetchErrors = 0;
    // null = complete scrape (reconciliation may run). A non-null string marks a
    // genuinely truncated scrape and suppresses stale-event reconciliation in scrape.ts.
    let kennelPagesStopReason: string | null = null;

    const fetchStart = Date.now();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${WPCOM_API}/posts?per_page=100&page=${page}&orderby=date&order=desc&_fields=id,date,link,title,content,categories`;
      let posts: WPComPost[];
      try {
        const resp = await safeFetch(url, {
          headers: { "User-Agent": "HashTracks-Scraper", Accept: "application/json" },
        });
        // WordPress.com returns 400 (not 404) for a page past the last — a clean end.
        if (resp.status === 400 || resp.status === 404) break;
        if (!resp.ok) {
          const msg = `WordPress.com API returned ${resp.status}`;
          errors.push(msg);
          (errorDetails.fetch ??= []).push({ url, status: resp.status, message: msg });
          kennelPageFetchErrors++;
          kennelPagesStopReason = `http-${resp.status}`;
          break;
        }
        posts = (await resp.json()) as WPComPost[];
      } catch (err) {
        const msg = `Fetch failed: ${err}`;
        errors.push(msg);
        (errorDetails.fetch ??= []).push({ url, message: msg });
        kennelPageFetchErrors++;
        kennelPagesStopReason = "fetch-failed";
        break;
      }

      if (!Array.isArray(posts) || posts.length === 0) break; // empty page — clean end
      for (const post of posts) events.push(...eventsFromPost(post));
      if (posts.length < 100) break; // partial last page — clean end
      if (page === MAX_PAGES) kennelPagesStopReason = "max-pages-hit"; // full page left unfetched
    }

    return {
      events,
      errors,
      errorDetails: hasAnyErrors(errorDetails) ? errorDetails : undefined,
      diagnosticContext: {
        fetchMethod: "wordpress-com-api",
        eventsParsed: events.length,
        kennelPageFetchErrors,
        kennelPagesStopReason,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
