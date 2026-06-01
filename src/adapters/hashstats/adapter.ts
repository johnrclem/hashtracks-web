import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails, ParseError } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { filterEventsByWindow, cleanLocationName } from "../utils";

/**
 * HashStats adapter — historical hash-event archive on the HashStats platform.
 *
 * HashStats (hashstats.org / hashingstats.com) is a multi-kennel *stats*
 * platform: each kennel exposes its complete archive of **completed** hashes
 * (with attendance counts) via a DataTables-style JSON endpoint:
 *
 *     POST {baseUrl}/{EXTERNAL_SLUG}/listhashes2
 *       body: draw=1&start=0&length=<big>
 *     → { aaData: [ { KENNEL_EVENT_NUMBER, EVENT_DATE, EVENT_LOCATION,
 *                     SPECIAL_EVENT_DESCRIPTION, FORMATTED_ADDRESS, HASY_KY, ... } ] }
 *
 * A single large `length` returns the entire archive (no pagination needed).
 *
 * IMPORTANT — this is a *retrospective* source: every row is an event that has
 * already happened. There is no upcoming-events surface. Seed it as a
 * supplemental / historical-backfill source (trust ~6) behind any kennel's
 * primary upcoming source (Google Calendar, etc.). See issue #1771.
 *
 * Routing: registered via the HTML_SCRAPER URL-matcher in registry.ts
 * (`/hashingstats\.com/i`) — no new SourceType enum needed (precedent: SHITH3
 * PHP REST API, Seletar JSON API). Kennel slugs are read directly from
 * `source.config.kennelSlugMap`, so the pipeline injects nothing extra.
 *
 * Only the public `hashingstats.com` hosts serve JSON to logged-out clients.
 * Other HashStats hosts (stats.daytonhhh.org, *.hashstats.org subdomains)
 * redirect to `/auth` and are intentionally NOT supported here.
 */

const DEFAULT_BASE_URL = "https://hashingstats.com";

/** Browser-y UA — the endpoint is public but rejects empty/odd user agents. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; HashTracksBot/1.0; +https://hashtracks.com)";

/** Request the full archive in one shot — the server returns all rows. */
const LIST_BODY = "draw=1&start=0&length=100000";

/** Single row from the `listhashes2` `aaData` array (fields we consume). */
export interface HashStatsRow {
  KENNEL_EVENT_NUMBER?: string;
  EVENT_DATE?: string; // "YYYY-MM-DD HH:MM:SS"
  EVENT_LOCATION?: string;
  SPECIAL_EVENT_DESCRIPTION?: string;
  EVENT_CITY?: string;
  EVENT_STATE?: string;
  FORMATTED_ADDRESS?: string;
  HASY_KY?: string; // detail-page key
}

/** Config shape for HashStats sources stored in Source.config. */
export interface HashStatsConfig {
  /** Override the API host. Defaults to "https://hashingstats.com". */
  baseUrl?: string;
  /**
   * Map of HashTracks kennelCode → HashStats external slug, e.g.
   * `{ sch4: "SCH4" }`. One source row can drive many kennels off this map.
   * Required and non-empty — a missing map fails loud (no silent 0 events).
   */
  kennelSlugMap?: Record<string, string>;
}

/**
 * HashStats stores "no description" rows literally as "None". Treat that (and
 * empty/whitespace) as "no theme" so it doesn't surface as event prose.
 */
function normalizeDescription(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return undefined;
  return trimmed;
}

/**
 * Parse HashStats `EVENT_DATE` ("2026-05-21 19:00:00") into a calendar date
 * + optional start time. Validates the date is real (rejects 2026-02-30 etc.)
 * Returns null when the date portion is missing/invalid so the caller can
 * fail loud and skip the row rather than emitting a garbage date.
 *
 * `startTime` is dropped for the "00:00" midnight sentinel (HashStats uses it
 * when no real start time was recorded).
 */
export function parseHashStatsDateTime(
  raw: string | undefined,
): { date: string; startTime?: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec((raw ?? "").trim());
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);

  // Round-trip through UTC noon to reject impossible dates (Feb 30, month 13).
  const probe = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  const date = `${m[1]}-${m[2]}-${m[3]}`;

  let startTime: string | undefined;
  if (m[4] != null && m[5] != null) {
    const hh = Number(m[4]);
    const mm = Number(m[5]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59 && !(hh === 0 && mm === 0)) {
      startTime = `${m[4]}:${m[5]}`;
    }
  }

  return startTime ? { date, startTime } : { date };
}

/**
 * Map one HashStats row to RawEventData for a given kennel tag. Returns null
 * when EVENT_DATE is unparseable (caller records a parse error and skips).
 *
 * Title is intentionally left undefined so the merge pipeline synthesizes the
 * canonical "<KennelName> Trail #N" — the theme goes in `description` instead.
 * Run number comes straight from the clean integer KENNEL_EVENT_NUMBER field
 * (not extractHashRunNumber, which is for free-form `#NNN` text).
 */
export function mapHashStatsRow(
  row: HashStatsRow,
  kennelTag: string,
  baseUrl: string,
  externalSlug: string,
): RawEventData | null {
  const parsed = parseHashStatsDateTime(row.EVENT_DATE);
  if (!parsed) return null;

  const runNumberRaw = Number(row.KENNEL_EVENT_NUMBER);
  const runNumber =
    Number.isFinite(runNumberRaw) && runNumberRaw > 0 ? runNumberRaw : undefined;

  const street = row.FORMATTED_ADDRESS?.trim();
  const hasyKy = row.HASY_KY?.trim();

  const raw: RawEventData = {
    date: parsed.date,
    kennelTags: [kennelTag],
    // title omitted on purpose — merge.ts synthesizes "<Kennel> Trail #N".
    ...(runNumber !== undefined ? { runNumber } : {}),
    ...(parsed.startTime ? { startTime: parsed.startTime } : {}),
    description: normalizeDescription(row.SPECIAL_EVENT_DESCRIPTION),
    location: cleanLocationName(row.EVENT_LOCATION),
    ...(street ? { locationStreet: street } : {}),
    ...(hasyKy
      ? { sourceUrl: `${baseUrl}/${encodeURIComponent(externalSlug)}/hashes/${hasyKy}` }
      : {}),
  };

  return raw;
}

export class HashStatsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = (source.config ?? {}) as HashStatsConfig;
    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchErrors: NonNullable<ErrorDetails["fetch"]> = [];
    const parseErrors: ParseError[] = [];
    const fetchStart = Date.now();

    const entries = Object.entries(config.kennelSlugMap ?? {});
    if (entries.length === 0) {
      const msg =
        "HashStats: config.kennelSlugMap is missing or empty — cannot resolve external kennel slugs";
      return { events: [], errors: [msg], errorDetails: { fetch: [{ message: msg }] } };
    }

    const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const days = options?.days ?? source.scrapeDays ?? 365;

    let apiRowsReturned = 0;

    for (const [kennelTag, externalSlug] of entries) {
      const url = `${baseUrl}/${encodeURIComponent(externalSlug)}/listhashes2`;
      let rows: unknown;
      let reportedTotal = Number.NaN;
      try {
        const res = await safeFetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: LIST_BODY,
        });
        if (!res.ok) {
          const msg = `HashStats ${externalSlug}: HTTP ${res.status}`;
          fetchErrors.push({ url, status: res.status, message: msg });
          errors.push(msg);
          continue;
        }
        const json = (await res.json()) as {
          aaData?: unknown;
          iTotalRecords?: unknown;
          iTotalDisplayRecords?: unknown;
        };
        rows = json?.aaData;
        reportedTotal = Number(json?.iTotalRecords ?? json?.iTotalDisplayRecords);
      } catch (err) {
        const msg = `HashStats ${externalSlug}: fetch error: ${err instanceof Error ? err.message : String(err)}`;
        fetchErrors.push({ url, message: msg });
        errors.push(msg);
        continue;
      }

      // Runtime shape guard — never trust the cast. A 200 with a non-array
      // body (auth HTML, error JSON) must fail loud rather than silently yield
      // 0 events, which would let the reconciler cancel live canonical events.
      if (!Array.isArray(rows)) {
        const msg = `HashStats ${externalSlug}: response missing aaData array`;
        fetchErrors.push({ url, message: msg });
        errors.push(msg);
        continue;
      }

      // DataTables reports the true row count in iTotalRecords. We request the
      // whole archive in one shot (length=100000); if the server caps the page
      // and returns fewer rows than the total, treating it as the complete
      // archive would let the reconciler CANCEL the missing historical events
      // (this source's scrapeDays spans the full 1995→present window). Fail
      // loud — an error blocks reconcile (scrape.ts gates on errors.length===0)
      // — and skip the partial page rather than emit a half-archive. (#1771)
      if (Number.isFinite(reportedTotal) && reportedTotal > rows.length) {
        const msg = `HashStats ${externalSlug}: partial archive — got ${rows.length} of ${reportedTotal} rows (server-capped); skipping to avoid false reconcile cancellations`;
        fetchErrors.push({ url, message: msg });
        errors.push(msg);
        continue;
      }

      apiRowsReturned += rows.length;

      rows.forEach((rawRow, index) => {
        const row = rawRow as HashStatsRow;
        const mapped = mapHashStatsRow(row, kennelTag, baseUrl, externalSlug);
        if (!mapped) {
          const ref = row?.KENNEL_EVENT_NUMBER ?? "?";
          const msg = `HashStats ${externalSlug}: skipped event #${ref} — unparseable EVENT_DATE "${row?.EVENT_DATE ?? ""}"`;
          parseErrors.push({ row: index, section: externalSlug, field: "date", error: msg });
          errors.push(msg);
          return;
        }
        events.push(mapped);
      });
    }

    if (fetchErrors.length) errorDetails.fetch = fetchErrors;
    if (parseErrors.length) errorDetails.parse = parseErrors;

    // Honor options.days via the shared window filter (events are mapped from
    // the full archive above, then trimmed to the requested ±days window).
    const windowedEvents = filterEventsByWindow(events, days);

    return {
      events: windowedEvents,
      errors,
      ...(hasAnyErrors(errorDetails) ? { errorDetails } : {}),
      diagnosticContext: {
        fetchDurationMs: Date.now() - fetchStart,
        kennelsRequested: entries.length,
        apiRowsReturned,
        eventsEmitted: windowedEvents.length,
      },
    };
  }
}
