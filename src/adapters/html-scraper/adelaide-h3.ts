import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { safeFetch } from "../safe-fetch";
import { applyDateWindow, isPlaceholder, normalizeHaresField } from "../utils";
import { composeUtcStart } from "@/lib/timezone";

/**
 * Adelaide H3 — ah3.com.au
 *
 * The kennel's WordPress site exposes its FullCalendar widget via an
 * unauthenticated `admin-ajax.php?action=get_events` endpoint. The
 * endpoint returns a JSON array of event objects shaped like:
 *
 *   [
 *     { id, title: "RUN 2645 - Crunchy Crack and Unstoppable",
 *       start: "2026-04-13 19:00:00", end: "...", allDay, className: "cat4" }
 *   ]
 *
 * Two important quirks (Chrome verified):
 *  - We pass `start = now()` (NOT `now() - days`). The endpoint returns
 *    in-window events unfiltered, and we only care about future runs.
 *  - We do NOT filter by `className`. Both `cat4` (regular) and `cat1`
 *    (milestone "2600th Run!! - Committee") are real runs.
 *
 * Title regex tolerates the optional "Run "/"RUN " prefix and ordinal
 * suffix (e.g. "2600th Run!! - Committee"). The hare list is whatever
 * follows the dash; "TBA" / "Hare TBA" are stripped via
 * `normalizeHaresField()` indirectly (TBA never appears comma-separated)
 * by an explicit placeholder check below.
 *
 * No location field is exposed by the API; left undefined for now.
 */

const KENNEL_TAG = "ah3-au";
const SOURCE_URL_DEFAULT = "https://ah3.com.au/wp-admin/admin-ajax.php";
const ADELAIDE_TZ = "Australia/Adelaide";
// A 180-day window returns ~26 future runs. Cap at 50 to cover the typical
// scrape window with headroom, keeping the per-scrape budget bounded
// (50 × 250ms = ~12.5s) while tracking drop-offs via `detailsSkippedByCap`.
const DETAIL_FETCH_CAP = 50;
const DETAIL_FETCH_DELAY_MS = 250;

interface AdelaideEventRow {
  id?: string | number;
  title?: string;
  start?: string;
  end?: string;
  allDay?: string | boolean;
  className?: string;
}

// Matches two title shapes:
//   "RUN 2645 - Crunchy Crack and Unstoppable"     (regular — leading "RUN" keyword)
//   "2600th Run!! - Committee"                      (milestone — ordinal + trailing "Run")
const TITLE_RE =
  /^\s*(?:RUN\s+)?(\d+)(?:st|nd|rd|th)?(?:\s*Run)?\s*!*\s*[-–—]\s*(.+?)\s*$/i;

/**
 * Parse a single Adelaide event row into a RawEventData. Returns null
 * when the title or start timestamp can't be parsed.
 *
 * Exported for unit testing.
 */
export function parseAdelaideEvent(
  row: AdelaideEventRow,
  sourceUrl: string,
): RawEventData | null {
  if (!row || typeof row !== "object") return null;
  const title = typeof row.title === "string" ? row.title : "";
  const start = typeof row.start === "string" ? row.start : "";
  if (!title || !start) return null;

  // "2026-04-13 19:00:00" → date "2026-04-13", time "19:00"
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(start);
  if (!dateMatch) return null;
  const date = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  const startTime = dateMatch[4] && dateMatch[5] ? `${dateMatch[4]}:${dateMatch[5]}` : undefined;

  const titleMatch = TITLE_RE.exec(title);
  if (!titleMatch) return null;
  const runNumber = Number.parseInt(titleMatch[1], 10);
  // Strip exclamation noise (e.g. "Committee!!") before placeholder check.
  const haresRaw = titleMatch[2].replace(/!+/g, "").trim();
  const hares = !haresRaw || isPlaceholder(haresRaw) || /^hare\s*tba$/i.test(haresRaw)
    ? undefined
    : normalizeHaresField(haresRaw);

  return {
    date,
    kennelTags: [KENNEL_TAG],
    title,
    runNumber,
    hares,
    startTime,
    sourceUrl,
  };
}

interface AdelaideEventDetail {
  location?: string;
  locationStreet?: string;
  description?: string;
  locationUrl?: string;
}

/**
 * Check whether a maps URL's `?q=` parameter is a placeholder like `TBA`/`TBD`.
 * Uses a lenient regex (not `new URL`) because the source sometimes emits
 * unescaped `+` in the query and we only need the raw token.
 */
function isPlaceholderMapQuery(href: string): boolean {
  const q = /[?&]q=([^&#]*)/.exec(href);
  if (!q?.[1]) return false;
  return isPlaceholder(decodeURIComponent(q[1].replaceAll("+", " ")));
}

/**
 * Parse the HTML content returned by `action=get_event`.
 * Shape: `.description`, `.location > span:nth-child(1|2)`, `a.maplink[href]`.
 * Exported for unit testing.
 */
export function parseAdelaideDetail(contentHtml: string): AdelaideEventDetail {
  const $ = cheerio.load(contentHtml);
  const spans = $(".location span");
  const venue = spans.eq(0).text().trim();
  const address = spans.eq(1).text().trim();
  const description = $(".description").first().text().trim();
  const mapHref = $("a.maplink").first().attr("href")?.trim();
  // Drop placeholder venue/street ("TBA", "TBD") so the pipeline doesn't store
  // "TBA" as a location or build a junk `?q=TBA` Maps URL.
  const locationClean = venue && !isPlaceholder(venue) ? venue : undefined;
  const streetClean = address && !isPlaceholder(address) ? address : undefined;
  // Map URL is independent of venue/street: only suppress when the map's own
  // `?q=` query is a placeholder (e.g. `?q=TBA`).
  const mapClean = mapHref && isPlaceholderMapQuery(mapHref) ? undefined : mapHref || undefined;
  return {
    location: locationClean,
    locationStreet: streetClean,
    description: description || undefined,
    locationUrl: mapClean,
  };
}

/**
 * Parse the list-endpoint wall-clock string ("2026-04-13 19:00:00") as
 * Adelaide-local (Australia/Adelaide handles ACST/ACDT transitions) and
 * return unix seconds. Treating the string as UTC would drift the epoch
 * by 9.5–10.5 hours. Delegates to `composeUtcStart` — the shared helper
 * already handles DST transitions correctly via date-fns `{ in: tz(...) }`.
 */
export function adelaideWallClockToUnix(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2})(?::\d{2})?)?$/.exec(iso);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const dateUtcNoon = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), 12));
  const zoned = composeUtcStart(dateUtcNoon, `${h}:${mi}`, ADELAIDE_TZ);
  if (!zoned) return null;
  const epoch = zoned.getTime();
  return Number.isNaN(epoch) ? null : Math.floor(epoch / 1000);
}

async function fetchAdelaideDetail(
  baseUrl: string,
  id: string | number,
  startIso: string,
  endIso: string,
): Promise<AdelaideEventDetail | null> {
  const start = adelaideWallClockToUnix(startIso);
  const end = adelaideWallClockToUnix(endIso);
  if (start == null || end == null) return null;

  const body = `action=get_event&id=${encodeURIComponent(String(id))}&start=${start}&end=${end}`;
  try {
    const res = await safeFetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
      },
      body,
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { content?: string };
    if (typeof payload?.content !== "string") return null;
    return parseAdelaideDetail(payload.content);
  } catch (err) {
    console.error(`[adelaide-h3] detail fetch failed for id ${id}:`, err);
    return null;
  }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

type DetailTarget = { eventIndex: number; row: AdelaideEventRow };

/**
 * POST the admin-ajax list endpoint and normalize the response into either
 * a rows array or a pre-built error ScrapeResult. Splitting this off keeps
 * the main `fetch()` orchestration below SonarCloud's cognitive-complexity
 * ceiling (S3776).
 */
async function fetchAdelaideList(
  url: string,
  nowSec: number,
  endSec: number,
): Promise<{ rows: AdelaideEventRow[]; error?: ScrapeResult }> {
  const body = `action=get_events&start=${nowSec}&end=${endSec}`;
  try {
    const res = await safeFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)",
      },
      body,
    });
    if (!res.ok) {
      const message = `Adelaide H3 admin-ajax HTTP ${res.status}`;
      return {
        rows: [],
        error: {
          events: [],
          errors: [message],
          errorDetails: { fetch: [{ url, status: res.status, message }] },
        },
      };
    }
    const payload = (await res.json()) as unknown;
    // The endpoint returns either an array of rows or some kind of error
    // envelope. Treat anything non-array as a hard parse failure so the
    // reconciler does not cancel live events.
    if (!Array.isArray(payload)) {
      const message = "Adelaide H3 admin-ajax returned a non-array payload";
      return {
        rows: [],
        error: {
          events: [],
          errors: [message],
          errorDetails: { parse: [{ row: 0, error: message }] },
        },
      };
    }
    return { rows: payload as AdelaideEventRow[] };
  } catch (err) {
    const message = `Adelaide H3 fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      rows: [],
      error: {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url, message }] },
      },
    };
  }
}

/**
 * Remove the event theme (typically the WordPress description value, e.g.
 * "Anzac Day run") from a comma-separated hares string. For special runs the
 * source organizer appends the theme to the title after a comma, so
 * `parseAdelaideEvent` extracts it as a hare segment. Once the per-event
 * detail fetch returns a description, we can identify and drop the matching
 * segment. See #1059.
 *
 * Comparison is case-insensitive and trims surrounding whitespace; remaining
 * segments are joined back with ", " in their original order.
 *
 * Exported for unit testing.
 */
export function stripThemeFromHares(
  hares: string | undefined,
  description: string | undefined,
): string | undefined {
  if (!hares) return undefined;
  if (!description) return hares;
  const theme = description.trim().toLowerCase();
  if (!theme) return hares;
  const segments = hares
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.toLowerCase() !== theme);
  return segments.length > 0 ? segments.join(", ") : undefined;
}

function applyAdelaideDetail(event: RawEventData, detail: AdelaideEventDetail): RawEventData {
  // Return a new RawEventData rather than mutating in place — the immutable-
  // audit-trail rule (CLAUDE.md) treats RawEvent records as read-only after
  // creation. Special-run titles append the theme after a comma (#1059); once
  // the WordPress description gives us the canonical theme text, strip it
  // from the title-derived `hares` field.
  return {
    ...event,
    ...(detail.location ? { location: detail.location } : {}),
    ...(detail.locationStreet ? { locationStreet: detail.locationStreet } : {}),
    ...(detail.description
      ? {
          description: detail.description,
          ...(event.hares ? { hares: stripThemeFromHares(event.hares, detail.description) } : {}),
        }
      : {}),
    ...(detail.locationUrl ? { locationUrl: detail.locationUrl } : {}),
  };
}

/**
 * Per-event detail enrichment: the list endpoint omits venue/address. The
 * FullCalendar widget fetches each cell's detail via `action=get_event`.
 *
 * Order-of-operations matters:
 *  1. Drop rows missing id/start/end (they can't be enriched, and shouldn't
 *     consume cap slots or pollute the `detailsFailed` counter).
 *  2. Sort by `row.start` ascending so nearest-future events are enriched
 *     first — those are the ones users are most likely to look at.
 *  3. Slice to DETAIL_FETCH_CAP; surface the drop count as
 *     `detailsSkippedByCap` so we notice silently-missed enrichment.
 *  4. Space requests by DETAIL_FETCH_DELAY_MS to avoid hammering the host.
 */
async function enrichAdelaideEvents(
  url: string,
  events: RawEventData[],
  detailTargets: DetailTarget[],
): Promise<{
  detailsFetched: number;
  detailsFailed: number;
  detailsSkippedMissingFields: number;
  detailsSkippedByCap: number;
}> {
  const enrichable: DetailTarget[] = [];
  let detailsSkippedMissingFields = 0;
  for (const target of detailTargets) {
    const { row } = target;
    if (!row.id || !row.start || !row.end) {
      detailsSkippedMissingFields++;
    } else {
      enrichable.push(target);
    }
  }
  enrichable.sort((a, b) => (a.row.start ?? "").localeCompare(b.row.start ?? ""));
  const targets = enrichable.slice(0, DETAIL_FETCH_CAP);
  const detailsSkippedByCap = Math.max(0, enrichable.length - targets.length);

  let detailsFetched = 0;
  let detailsFailed = 0;
  for (let i = 0; i < targets.length; i++) {
    const { eventIndex, row } = targets[i];
    const detail = await fetchAdelaideDetail(url, row.id!, row.start!, row.end!);
    if (detail) {
      events[eventIndex] = applyAdelaideDetail(events[eventIndex], detail);
      detailsFetched++;
    } else {
      detailsFailed++;
    }
    // Skip delay after the last iteration — final sleep is wasted time.
    if (i < targets.length - 1) await sleep(DETAIL_FETCH_DELAY_MS);
  }
  return { detailsFetched, detailsFailed, detailsSkippedMissingFields, detailsSkippedByCap };
}

export class AdelaideH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const url = source.url || SOURCE_URL_DEFAULT;
    const days = options?.days ?? source.scrapeDays ?? 180;

    const nowSec = Math.floor(Date.now() / 1000);
    const endSec = nowSec + days * 86400;
    const fetchStart = Date.now();

    const { rows, error } = await fetchAdelaideList(url, nowSec, endSec);
    if (error) return error;

    const events: RawEventData[] = [];
    const detailTargets: DetailTarget[] = [];
    let skipped = 0;
    for (const row of rows) {
      const event = parseAdelaideEvent(row, url);
      if (event) {
        detailTargets.push({ eventIndex: events.length, row });
        events.push(event);
      } else {
        skipped++;
      }
    }

    const {
      detailsFetched,
      detailsFailed,
      detailsSkippedMissingFields,
      detailsSkippedByCap,
    } = await enrichAdelaideEvents(url, events, detailTargets);

    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    if (events.length === 0) {
      const message = "Adelaide H3 scraper parsed 0 runs — possible API drift";
      errors.push(message);
      errorDetails.parse = [{ row: 0, error: message }];
    }

    return applyDateWindow(
      {
        events,
        errors,
        errorDetails: errors.length > 0 ? errorDetails : undefined,
        diagnosticContext: {
          fetchMethod: "wp-admin-ajax",
          rowsFetched: rows.length,
          eventsParsed: events.length,
          skippedRows: skipped,
          detailsFetched,
          detailsFailed,
          detailsSkippedMissingFields,
          detailsSkippedByCap,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
