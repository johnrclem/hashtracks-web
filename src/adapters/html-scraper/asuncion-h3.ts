import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { stripHtmlTags, decodeEntities } from "../utils";
import { safeFetch } from "../safe-fetch";
import { isValidCoords } from "@/lib/geo";

/**
 * Asunción H3 — Asunción Hash House Harriers (Asunción, Paraguay).
 * HashTracks' first South American kennel.
 *
 * Source: public WordPress.com blog at asuncionh3.wordpress.com, read through
 * the WordPress.com public REST API (mirrors ONH3Adapter / SWH3Adapter). Every
 * run is a single post titled "Run #N" (category 1), with a bilingual two-column
 * body — English (left) then Spanish (right). The English column comes first in
 * document order, so taking the first match of each field yields the English text.
 *
 * The run date lives in the body header ("Saturday, 30 May 2026" /
 * "Saturday, 28th of May 2022"), NOT the post publish date — several historical
 * runs were batch-posted on a single day, so the publish date is unreliable.
 * Start coordinates come from the embedded Google Maps iframe (`pb=…!2d<lng>!3d<lat>`,
 * URL-encoded), which the shared extractCoordsFromMapsUrl does not parse.
 *
 * This adapter is future-only (emits date >= today); the 120-run archive
 * (#1 2021-12 → #120 2026-05) is loaded once via
 * scripts/backfill-asu-h3-history.ts, so the recurring scrape stays forward-looking.
 */

const WPCOM_API = "https://public-api.wordpress.com/wp/v2/sites/asuncionh3.wordpress.com";
const KENNEL_TAG = "asu-h3";
const KENNEL_TIMEZONE = "America/Asuncion";
const PER_PAGE = 100; // WordPress.com REST max
const MAX_PAGES = 3; // 3 × 100 = 300 posts; the blog currently holds 120 (page 3 → HTTP 400)

// "Run #120", "Run 120". \D{0,3} (not \s*#?\s*) avoids the whitespace-bracketed
// quantifier shape SonarCloud flags as ReDoS (S5852). \d+ keeps pre-#100 runs.
const RUN_TITLE_RE = /Run\b\D{0,3}(\d+)/i;
// Loose "D Month YYYY" — applied AFTER ordinal/"of" normalization. Month word
// (English or Spanish, accents allowed) validated against MONTHS below, so no
// 12-way alternation is enumerated in the pattern (S5843/S5852 safe).
const DMY_RE = /\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,12})\s+(\d{4})\b/;
// Time directly before "start"/"inicio" (the trail start, not the meet/bus time).
// [^\n\d]{0,8} keeps the match on one logical token without crossing to the next time.
const START_TIME_RE = /(\d{1,2}):(\d{2})[^\n\d]{0,8}(?:start|inicio)/i;
const ANY_TIME_RE = /(\d{1,2}):(\d{2})/;
// Per-line field labels (English column wins by document order). Bounded middles
// (no unbounded quantifier next to ":") keep these out of the ReDoS heuristics.
const HARE_LINE_RE = /^Hare\(s\)\s*:\s*(\S.*)$/i;
// Char classes use [A-Z …] (no a-z) because the /i flag already matches lowercase;
// including both ranges trips Sonar S5869 (duplicate char class under case-insensitive).
const START_LINE_RE = /^(?:Start|Location|Meeting point)[A-Z ()]{0,14}:\s*(\S.*)$/i;
const COST_LINE_RE = /^Costs?[A-Z ]{0,10}:\s*(\S.*)$/i;
// Google Maps embed iframe: `pb=…!2d<lng>!3d<lat>…`. The `!` arrive URL-encoded
// as `%21`; we normalize them before matching. NOTE: 2d is LONGITUDE, 3d is LATITUDE.
const EMBED_SRC_RE = /maps\/embed\?pb=([^"'\s>]+)/;
const EMBED_COORD_RE = /!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/;

/** Month name → 1-based number. English + Spanish (the EN column occasionally uses a Spanish month). */
const MONTH_MAP: Record<string, number> = {
  jan: 1, january: 1, enero: 1,
  feb: 2, february: 2, febrero: 2,
  mar: 3, march: 3, marzo: 3,
  apr: 4, april: 4, abril: 4, arpil: 4, // "arpil" — recurring source typo (runs #34, #35)
  may: 5, mayo: 5,
  jun: 6, june: 6, junio: 6,
  jul: 7, july: 7, julio: 7,
  aug: 8, august: 8, agosto: 8,
  sep: 9, sept: 9, september: 9, septiembre: 9, setiembre: 9,
  oct: 10, october: 10, octubre: 10,
  nov: 11, november: 11, noviembre: 11,
  dec: 12, december: 12, diciembre: 12,
};

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
 * Flatten post HTML to newline-delimited text. The date header is fragmented
 * across inline <strong> tags ("Saturday, 30 </strong><strong>May 2</strong>026");
 * inline tags strip without a separator so it reassembles, while <br>/block tags
 * become newlines so each labeled field lands on its own line.
 */
function flatten(html: string): string {
  return decodeEntities(stripHtmlTags(html, "\n")).replace(/[^\S\n]+/g, " ");
}

/**
 * Parse the in-body run date. Ordinal suffixes ("5th") and the connector "of"
 * ("5 of December") are stripped procedurally first so the loose DMY_RE matches
 * every historical variant. Returns YYYY-MM-DD or undefined.
 */
export function parseRunDate(text: string): string | undefined {
  const normalized = text
    .replace(/(\d)(?:st|nd|rd|th)\b/gi, "$1") // "5th" → "5"
    .replace(/(\d)\s+of\s+/gi, "$1 ") // "5 of December" → "5 December"
    .replace(/(\d)\s+de\s+/gi, "$1 "); // "30 de mayo" → "30 mayo" (Spanish connector)
  const m = DMY_RE.exec(normalized);
  if (!m) return undefined;
  const month = MONTH_MAP[m[2].toLowerCase()];
  if (month === undefined) return undefined;
  return iso(Number.parseInt(m[3], 10), month, Number.parseInt(m[1], 10));
}

/** Pad an "H:MM"/"HH:MM" capture to "HH:MM". */
function padTime(h: string, m: string): string {
  return `${h.padStart(2, "0")}:${m}`;
}

/**
 * Extract the trail start time as "HH:MM". Prefers the time tagged "start"/"inicio"
 * (e.g. "16:00 start of trail"), so a leading "(meet)" or bus-departure time is
 * not mistaken for the start. Falls back to the first time in the header region.
 */
export function parseStartTime(text: string): string | undefined {
  const region = text.slice(0, 600); // header block — avoids body prose times
  const start = START_TIME_RE.exec(region);
  if (start) return padTime(start[1], start[2]);
  const any = ANY_TIME_RE.exec(region);
  return any ? padTime(any[1], any[2]) : undefined;
}

/** First line matching `re` → its captured value (trimmed), else undefined. */
function firstLineField(lines: string[], re: RegExp): string | undefined {
  for (const line of lines) {
    const m = re.exec(line.trim());
    if (m) return m[1].trim();
  }
  return undefined;
}

/**
 * Start coordinates from the embedded Google Maps iframe. The shared
 * extractCoordsFromMapsUrl only matches `!3d…!4d…`/`@lat,lng` forms, not the
 * embed `pb=…!2d<lng>!3d<lat>` form — so parse it here. Mind the order: !2d is
 * longitude, !3d is latitude.
 */
export function extractStartCoords(html: string): { lat: number; lng: number } | undefined {
  const src = EMBED_SRC_RE.exec(html);
  if (!src) return undefined;
  const pb = src[1].replaceAll("%21", "!");
  const m = EMBED_COORD_RE.exec(pb);
  if (!m) return undefined;
  const lng = Number.parseFloat(m[1]);
  const lat = Number.parseFloat(m[2]);
  return isValidCoords(lat, lng) ? { lat, lng } : undefined;
}

/** A "Run #N" post → one event, or null if no parseable in-body date. */
export function postToEvent(post: WPComPost): RawEventData | null {
  const text = flatten(post.content.rendered);
  const date = parseRunDate(text);
  if (!date) return null;

  const lines = text.split("\n");
  // isRunPost (RUN_TITLE_RE) has already matched the title before postToEvent runs,
  // so runFromTitle always resolves the "Run #N" number.
  const runNumber = runFromTitle(post.title.rendered);
  const coords = extractStartCoords(post.content.rendered);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    runNumber,
    // Title left undefined — titles are bare "Run #N"; merge.ts synthesizes
    // "Asunción H3 Trail #N" (a title must never be a hare name or field fragment).
    hares: firstLineField(lines, HARE_LINE_RE),
    location: firstLineField(lines, START_LINE_RE),
    cost: firstLineField(lines, COST_LINE_RE),
    startTime: parseStartTime(text),
    latitude: coords?.lat,
    longitude: coords?.lng,
    sourceUrl: post.link,
  };
}

/** Run number from a bare "Run #N" / "Run N" title. */
function runFromTitle(title: string): number | undefined {
  const m = RUN_TITLE_RE.exec(title);
  return m ? Number.parseInt(m[1], 10) : undefined;
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

/**
 * Keep only run announcements: a "Run #N" title in the "Runs" category (id 1).
 * The category is a secondary guard against a non-run post that happens to carry
 * "Run #" in its title; it falls open (`?? true`) if a post omits categories.
 */
function isRunPost(post: WPComPost): boolean {
  return RUN_TITLE_RE.test(post.title.rendered) && (post.categories?.includes(1) ?? true);
}

/** Parse a page of posts into future-dated run events (the archive is backfilled separately). */
function parseFuturePosts(posts: WPComPost[], today: string): RawEventData[] {
  const events: RawEventData[] = [];
  for (const post of posts) {
    if (!isRunPost(post)) continue;
    const event = postToEvent(post);
    if (event && event.date >= today) events.push(event);
  }
  return events;
}

export class AsuncionH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(_source: Source, _options?: { days?: number }): Promise<ScrapeResult> {
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    let kennelPageFetchErrors = 0;
    // null = complete scrape (reconciliation may run). A non-null string marks a
    // truncated scrape and suppresses stale-event reconciliation in scrape.ts.
    let kennelPagesStopReason: string | null = null;

    const fetchStart = Date.now();
    // ISO YYYY-MM-DD in kennel-local time — bounds the future-only filter.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: KENNEL_TIMEZONE }).format(new Date());

    for (let page = 1; page <= MAX_PAGES; page++) {
      const result = await fetchPostsPage(page);
      if (result.kind === "end") {
        // WordPress.com returns 400/404 only for a page beyond the last, so this
        // is a clean end — EXCEPT on page 1, where it means the site/API is gone
        // or changed. Flag that as truncation so reconcile.ts doesn't read the
        // empty scrape as authoritative and cancel upcoming events (a healthy
        // "0 upcoming" scrape still returns posts on page 1, leaving this null).
        if (page === 1) {
          const message = "WordPress.com API returned 400/404 for page 1 (site/API unavailable)";
          errors.push(message);
          errorDetails.fetch ??= [];
          errorDetails.fetch.push({ url: `${WPCOM_API}/posts?page=1`, message });
          kennelPageFetchErrors++;
          kennelPagesStopReason = "first-page-unavailable";
        }
        break;
      }
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
      events.push(...parseFuturePosts(posts, today));
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
