import type { Source } from "@/generated/prisma/client";
import type { ErrorDetails, RawEventData, ScrapeResult, SourceAdapter } from "../types";
import { safeFetch } from "../safe-fetch";
import { applyDateWindow, isPlaceholder, normalizeHaresField } from "../utils";

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
    kennelTag: KENNEL_TAG,
    title,
    runNumber,
    hares,
    startTime,
    sourceUrl,
  };
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
    const body = `action=get_events&start=${nowSec}&end=${endSec}`;

    const fetchStart = Date.now();
    let payload: unknown;
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
          events: [],
          errors: [message],
          errorDetails: { fetch: [{ url, status: res.status, message }] },
        };
      }
      payload = await res.json();
    } catch (err) {
      const message = `Adelaide H3 fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return {
        events: [],
        errors: [message],
        errorDetails: { fetch: [{ url, message }] },
      };
    }

    // Runtime validation — the endpoint returns either an array of rows
    // or some kind of error envelope. Treat anything non-array as a hard
    // parse failure so the reconciler does not cancel live events.
    if (!Array.isArray(payload)) {
      const message = "Adelaide H3 admin-ajax returned a non-array payload";
      return {
        events: [],
        errors: [message],
        errorDetails: { parse: [{ row: 0, error: message }] },
      };
    }

    const events: RawEventData[] = [];
    let skipped = 0;
    for (const row of payload as AdelaideEventRow[]) {
      const event = parseAdelaideEvent(row, url);
      if (event) events.push(event);
      else skipped++;
    }

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
          rowsFetched: payload.length,
          eventsParsed: events.length,
          skippedRows: skipped,
          fetchDurationMs: Date.now() - fetchStart,
        },
      },
      days,
    );
  }
}
