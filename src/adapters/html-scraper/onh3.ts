import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { stripHtmlTags, decodeEntities, googleMapsSearchUrl, MONTHS, extractHashRunNumber, stripPlaceholder } from "../utils";
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
const KENNEL_TIMEZONE = "Africa/Nairobi";
const DEFAULT_START_TIME = "17:45"; // 5:45 PM per kennel convention (registration from 5:00 PM)
const PER_PAGE = 100; // WordPress.com REST max
const MAX_PAGES = 5; // 5 × 100 = 500 posts; the blog currently holds ~34

// "Run 1326", "Run #1068", "Run: #1068". \D{0,3} (not \s*#?\s*) avoids the
// whitespace-bracketed-quantifier shape SonarCloud flags as ReDoS (S5852).
// \d+ (not \d{3,4}) so pre-#100 historical runs aren't silently dropped.
const RUN_NUMBER_RE = /Run\b\D{0,3}(\d+)/i;
const DMY_TEXT_RE = /(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/; // "30 March 2026", "16 Mar 2019"
const DMY_NUMERIC_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/; // "05/01/2026" (DD/MM/YYYY)
const URL_RE = /(https?:\/\/\S+)/;
const HARELINE_TITLE_RE = /^\s*hareline\s+\d{4}/i;
const HASH_TRASH_TITLE_RE = /^\s*(?:past\s+)?hash\s*trash/i;
const HASH_TRASH_SPLIT_RE = /Hash\s+Trash/i;
// Boundary scanner for the multi-pass field tokenizer (S5852-safe: no nested quantifiers).
const FIELD_LABELS_RE = /(Date|Hares?|Venue|Location|Time|Run)\s*:/gi;

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

/**
 * Resolve a month name to a 1-based number via utils.MONTHS, which already keys
 * both full names and 3-letter abbreviations. Only "sept" needs normalizing.
 * Exact lookup (not a prefix slice) avoids false positives like "maybe" → "may".
 */
function monthNumber(word: string): number | undefined {
  const w = word.toLowerCase();
  return MONTHS[w === "sept" ? "sep" : w];
}

/** Parse "D Month YYYY" / "D Mon YYYY" text (weekday prefix tolerated by searching). */
export function parseTextDate(value: string): string | undefined {
  const m = DMY_TEXT_RE.exec(value);
  if (!m) return undefined;
  const month = monthNumber(m[2]);
  if (month === undefined) return undefined;
  return iso(Number.parseInt(m[3], 10), month, Number.parseInt(m[1], 10));
}

/** Parse "DD/MM/YYYY" (UK/Kenyan order — NOT US M/D/Y). */
export function parseNumericDate(value: string): string | undefined {
  const m = DMY_NUMERIC_RE.exec(value);
  if (!m) return undefined;
  return iso(Number.parseInt(m[3], 10), Number.parseInt(m[2], 10), Number.parseInt(m[1], 10));
}

/**
 * Tokenize every labeled field in one pass with the literal FIELD_LABELS_RE.
 * Each value runs from its label to the next label OR the next line break,
 * whichever comes first — the line break matters because ONH3 puts each field
 * in its own block element and appends an unlabeled "Hash Trash" recap, so a
 * trailing field like Venue would otherwise swallow the whole write-up.
 * Keyed lowercase, with "hares" normalized to "hare". A single literal regex
 * (no per-label `new RegExp`) avoids Semgrep's non-literal-regexp finding.
 */
export function parseLabeledFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();
  const matches = [...text.matchAll(FIELD_LABELS_RE)];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const raw = m[1].toLowerCase();
    const key = raw === "hares" ? "hare" : raw;
    const start = (m.index ?? 0) + m[0].length;
    const nextLabel = i + 1 < matches.length ? matches[i + 1].index ?? text.length : text.length;
    const nl = text.indexOf("\n", start);
    const end = Math.min(nextLabel, nl === -1 ? text.length : nl);
    const value = text.slice(start, end).trim();
    if (value && !fields.has(key)) fields.set(key, value);
  }
  return fields;
}

export function parseOnh3Title(title: string): { runNumber?: number; theme?: string } {
  const m = RUN_NUMBER_RE.exec(title);
  return { runNumber: m ? Number.parseInt(m[1], 10) : undefined, theme: deriveTheme(title) };
}

const THEME_EDGE_CHARS = " \t\n.-–|";

/** Trim leading/trailing separator chars without a regex (ReDoS-safe). */
function trimEdgeChars(s: string): string {
  let lo = 0;
  let hi = s.length;
  while (lo < hi && THEME_EDGE_CHARS.includes(s[lo])) lo++;
  while (hi > lo && THEME_EDGE_CHARS.includes(s[hi - 1])) hi--;
  return s.slice(lo, hi);
}

/**
 * Derive a human theme from the title, or undefined. Leaving it undefined lets
 * merge.ts synthesize the canonical "ONH3 Trail #N" title (a theme must never
 * be a hare name or a labeled-field fragment).
 */
export function deriveTheme(title: string): string | undefined {
  const stripped = title
    .replace(/^Monday\b.*?\|\s*/i, "") // "Monday 30 Mar 2026 | "
    .replace(/^ONH3\s+/i, "")
    .replace(RUN_NUMBER_RE, "");
  // Trim leading/trailing separators procedurally — a `^[…]+|[…]+$` regex trips
  // SonarCloud's ReDoS heuristic (S5852) even though it's linear here.
  const cleaned = trimEdgeChars(stripped);
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
  const fields = parseLabeledFields(announcement);

  const dateField = fields.get("date");
  const date = dateField ? parseTextDate(dateField) ?? parseNumericDate(dateField) : undefined;
  if (!date) return null;

  const { runNumber: titleRun, theme } = parseOnh3Title(post.title.rendered);
  // Body fallback uses the shared "#NNN" parser on the "Run:" field ("Run: #1068").
  const runNumber = titleRun ?? extractHashRunNumber(fields.get("run"));

  const hares = stripPlaceholder(fields.get("hare"));
  const venue = cleanVenue(stripPlaceholder(fields.get("venue")));
  const locationField = fields.get("location");
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

/**
 * An annual "Hareline YYYY" <table> post → one event per data row, emitting
 * only rows on/after `today`. The table is the sole source of ONH3's forward
 * advance schedule (the Google Calendar runs ~4 weeks ahead at most); past
 * rows are the kennel archive and are loaded once via
 * scripts/backfill-onh3-history.ts, so the recurring scrape stays future-only.
 */
export function parseHarelineTable(post: WPComPost, today: string): RawEventData[] {
  const $ = cheerio.load(post.content.rendered);
  const events: RawEventData[] = [];

  $("table tr").each((_, row) => {
    const cells = $(row)
      .find("td")
      .map((__, td) => decodeEntities($(td).text()).replace(/\s+/g, " ").trim())
      .get();
    if (cells.length < 5) return; // malformed / spacer row

    const runNumber = /^\d+$/.test(cells[0]) ? Number.parseInt(cells[0], 10) : undefined;
    const date = parseNumericDate(cells[2] ?? "");
    if (!date) return; // header row ("Run nr"/"Date") and blanks fall out here
    if (date < today) return; // past rows belong to the one-shot backfill

    const hares = stripPlaceholder(cells[3]);
    const venue = stripPlaceholder(cells[4]);
    const area = stripPlaceholder(cells[5]);
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

function eventsFromPost(post: WPComPost, today: string): RawEventData[] {
  const title = post.title.rendered;
  if (HARELINE_TITLE_RE.test(title)) return parseHarelineTable(post, today);
  if (HASH_TRASH_TITLE_RE.test(title)) return []; // standalone recap, not an upcoming run
  const event = postToEvent(post);
  return event ? [event] : [];
}

type PageResult =
  | { kind: "posts"; posts: WPComPost[] }
  | { kind: "end" } // 400/404 past the last page — a clean end
  | { kind: "error"; url: string; status?: number; message: string; stopReason: string };

async function fetchPostsPage(page: number): Promise<PageResult> {
  const url = `${WPCOM_API}/posts?per_page=${PER_PAGE}&page=${page}&orderby=date&order=desc&_fields=id,date,link,title,content,categories`;
  try {
    const resp = await safeFetch(url, {
      headers: { "User-Agent": "HashTracks-Scraper", Accept: "application/json" },
    });
    if (resp.status === 400 || resp.status === 404) return { kind: "end" };
    if (!resp.ok) {
      const message = `WordPress.com API returned ${resp.status}`;
      return { kind: "error", url, status: resp.status, message, stopReason: `http-${resp.status}` };
    }
    return { kind: "posts", posts: (await resp.json()) as WPComPost[] };
  } catch (err) {
    return { kind: "error", url, message: `Fetch failed: ${err}`, stopReason: "fetch-failed" };
  }
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
    // ISO YYYY-MM-DD in kennel-local time — bounds the Hareline-table future filter.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: KENNEL_TIMEZONE }).format(new Date());

    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await fetchPostsPage(page);
      if (result.kind === "end") break;
      if (result.kind === "error") {
        errors.push(result.message);
        errorDetails.fetch ??= [];
        errorDetails.fetch.push({ url: result.url, status: result.status, message: result.message });
        kennelPageFetchErrors++;
        kennelPagesStopReason = result.stopReason;
        break;
      }
      const { posts } = result;
      if (!Array.isArray(posts) || posts.length === 0) break; // empty page — clean end
      for (const post of posts) events.push(...eventsFromPost(post, today));
      if (posts.length < PER_PAGE) break; // partial last page — clean end
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
