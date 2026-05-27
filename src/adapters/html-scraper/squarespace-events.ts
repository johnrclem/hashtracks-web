import type { Source } from "@/generated/prisma/client";
import type {
  ErrorDetails,
  RawEventData,
  ScrapeResult,
  SourceAdapter,
} from "../types";
import { safeFetch } from "../safe-fetch";
import {
  applyDateWindow,
  decodeEntities,
  extractHashRunNumber,
  stripHtmlTags,
  validateSourceConfig,
} from "../utils";
import { formatYmdInTimezone, isValidTimezone } from "@/lib/timezone";

/**
 * Shared adapter for Squarespace-hosted Events collections.
 *
 * Squarespace exposes every Events collection as JSON via the standard
 * `?format=json` query the platform applies to all collection URLs. The
 * payload structure is stable across tenants:
 *
 *   {
 *     website: { timeZone: "America/Los_Angeles", baseUrl: "https://...", ... },
 *     upcoming: SquarespaceEvent[],
 *     past:     SquarespaceEvent[],
 *     pagination: { nextPage, nextPageOffset, nextPageUrl, pageSize },
 *     ...
 *   }
 *
 * Each event carries:
 *   - title              — string
 *   - startDate, endDate — epoch milliseconds (UTC instant)
 *   - location           — { addressTitle, addressLine1, addressLine2, ... }
 *   - body               — HTML string (the event description blurb)
 *   - fullUrl            — site-relative event detail path, e.g. "/events/<slug>"
 *
 * Note: the collection-level `?format=ical` export is gated by a Squarespace
 * tenant setting. When disabled it silently 200s with the regular HTML
 * events page, so iCal cannot be the load-bearing path for tenants who
 * haven't enabled it. The JSON endpoint is always on.
 */

export interface SquarespaceEventsConfig {
  kennelTag: string;
  /** Optional override for the events collection path (default `/events`). */
  collectionPath?: string;
  /**
   * Optional override timezone. Normally we read `website.timeZone` from
   * the payload; this config field is the escape hatch for tenants whose
   * timezone string is missing or malformed.
   */
  timezone?: string;
  /**
   * Optional fallback startTime ("HH:MM") for events whose startDate has
   * a degenerate time-of-day component (e.g. midnight epoch placeholders).
   */
  fallbackStartTime?: string;
}

interface SquarespaceLocation {
  addressTitle?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCountry?: string | null;
  /**
   * Map pin coordinates of the venue. NOTE: the JSON also exposes
   * `markerLat`/`markerLng` — those are a default fallback (often NYC) when
   * the user pins the map but skips an explicit address, so we read
   * `mapLat`/`mapLng` exclusively to avoid wiring 40.72/-74.00 onto trails
   * across the country.
   */
  mapLat?: number | null;
  mapLng?: number | null;
}

interface SquarespaceEvent {
  id?: string;
  urlId?: string;
  title?: string;
  fullUrl?: string;
  startDate?: number;
  endDate?: number;
  body?: string;
  excerpt?: string;
  location?: SquarespaceLocation | null;
}

interface SquarespaceEventsPayload {
  website?: { timeZone?: string; baseUrl?: string };
  upcoming?: SquarespaceEvent[];
  past?: SquarespaceEvent[];
}

/**
 * Strip trailing slashes via procedural slice (NOT regex). Sonar S5852
 * false-positives any `/\/+$/`-shape regex as ReDoS even though the anchor
 * makes it linear; the procedural form satisfies the analyzer without
 * resorting to `// NOSONAR` (see `feedback_sonar_s5852_procedural_over_regex`).
 */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charAt(end - 1) === "/") end--;
  return s.slice(0, end);
}

/**
 * Resolve the collection JSON URL the adapter should fetch.
 *
 * Defensive: if the base URL's pathname already includes the collection
 * path (e.g. a seed row that stores `https://example.com/events`), don't
 * double-append it. The collectionPath argument wins when present.
 */
function resolveCollectionUrl(baseUrl: string, collectionPath: string): string {
  const url = new URL(baseUrl);
  const basePath = trimTrailingSlashes(url.pathname);
  const cleanPath = collectionPath.startsWith("/")
    ? collectionPath
    : `/${collectionPath}`;
  const finalPath =
    trimTrailingSlashes(basePath) === trimTrailingSlashes(cleanPath)
      ? cleanPath
      : basePath + cleanPath;
  url.pathname = finalPath;
  // Squarespace requires the query param even when the path already has one.
  url.searchParams.set("format", "json");
  return url.toString();
}

/** Resolve the absolute URL for an event detail page. */
function resolveEventUrl(baseUrl: string, fullUrl: string | undefined): string | undefined {
  if (!fullUrl) return undefined;
  if (fullUrl.startsWith("http://") || fullUrl.startsWith("https://")) return fullUrl;
  const cleanBase = trimTrailingSlashes(baseUrl);
  const cleanPath = fullUrl.startsWith("/") ? fullUrl : `/${fullUrl}`;
  return cleanBase + cleanPath;
}

/**
 * Compose a single-line address string from Squarespace's two-line address
 * shape. Returns undefined when both lines are blank — emitting an empty
 * string would leak through merge.ts as a legitimate "location cleared"
 * signal and stomp on prior values.
 */
function composeLocationStreet(loc: SquarespaceLocation): string | undefined {
  const lines = [loc.addressLine1, loc.addressLine2]
    .map((s) => (s ?? "").trim())
    .filter((s) => s.length > 0);
  if (lines.length === 0) return undefined;
  return lines.join(", ");
}

/**
 * Extract local "HH:MM" 24h time from an absolute epoch-ms instant in the
 * given IANA timezone. Returns undefined if the timezone is invalid or the
 * timestamp is degenerate.
 */
function formatLocalTime(epochMs: number, timezone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(epochMs));
    const hh = parts.find((p) => p.type === "hour")?.value;
    const mm = parts.find((p) => p.type === "minute")?.value;
    if (!hh || !mm) return undefined;
    // Intl returns "24" for midnight in some locales — normalize to "00".
    return `${hh === "24" ? "00" : hh}:${mm}`;
  } catch {
    return undefined;
  }
}

/**
 * Convert one Squarespace event row into RawEventData. Returns null when
 * `startDate` is missing or unparseable — date is the minimum viable field
 * for downstream dedup.
 *
 * Exported for unit testing.
 */
export function parseSquarespaceEvent(
  event: SquarespaceEvent,
  config: SquarespaceEventsConfig,
  baseUrl: string,
  timezone: string,
): RawEventData | null {
  // Defensive: Squarespace responses occasionally include `null` entries
  // alongside real events (e.g. mid-rotation drafts). TS interface narrowing
  // is compile-time only and won't filter at runtime.
  if (!event || typeof event !== "object") return null;

  const startMs = event.startDate;
  if (typeof startMs !== "number" || !Number.isFinite(startMs) || startMs <= 0) {
    return null;
  }

  const date = formatYmdInTimezone(new Date(startMs), timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  // Multi-day events (campouts spanning Friday → Sunday) carry an endDate
  // epoch on a later calendar day. RawEventData.endDate is the canonical
  // "single-row date-range" field; emit only when the end day is strictly
  // after the start day so normal evening trails (start 18:30, end 21:30
  // same day) don't get a spurious endDate that re-fingerprints them.
  const endMs = event.endDate;
  let endDate: string | undefined;
  if (typeof endMs === "number" && Number.isFinite(endMs) && endMs > startMs) {
    const endYmd = formatYmdInTimezone(new Date(endMs), timezone);
    if (/^\d{4}-\d{2}-\d{2}$/.test(endYmd) && endYmd > date) {
      endDate = endYmd;
    }
  }

  const title = event.title?.trim() || undefined;
  const loc = event.location ?? {};
  // `decodeEntities` after `stripHtmlTags` is the documented convention
  // (`feedback_use_decode_entities`). Cheerio's `.text()` decodes most
  // entities natively, but defense-in-depth covers numeric (`&#039;`) and
  // less-common named entities that may slip through.
  const description = event.body
    ? decodeEntities(stripHtmlTags(event.body))
    : undefined;

  const latitude =
    typeof loc.mapLat === "number" && Number.isFinite(loc.mapLat) ? loc.mapLat : undefined;
  const longitude =
    typeof loc.mapLng === "number" && Number.isFinite(loc.mapLng) ? loc.mapLng : undefined;

  return {
    date,
    endDate,
    kennelTags: [config.kennelTag],
    runNumber: extractHashRunNumber(title),
    title,
    description: description || undefined,
    location: loc.addressTitle?.trim() || undefined,
    locationStreet: composeLocationStreet(loc),
    latitude,
    longitude,
    startTime: formatLocalTime(startMs, timezone) ?? config.fallbackStartTime,
    sourceUrl: resolveEventUrl(baseUrl, event.fullUrl),
  };
}

/**
 * Fetch + parse a Squarespace events collection. Exported so a one-shot
 * historical backfill script can paginate via `?offset=NNNN` without
 * re-implementing the per-event mapping.
 */
export async function fetchSquarespaceEvents(
  source: Source,
  config: SquarespaceEventsConfig,
): Promise<{
  events: RawEventData[];
  errors: string[];
  errorDetails?: ErrorDetails;
  diagnosticContext: Record<string, unknown>;
}> {
  if (!source.url) {
    return {
      events: [],
      errors: ["SquarespaceEventsAdapter: source.url is required"],
      diagnosticContext: {},
    };
  }

  const collectionUrl = resolveCollectionUrl(
    source.url,
    config.collectionPath ?? "/events",
  );

  const t0 = Date.now();
  let response: Response;
  try {
    response = await safeFetch(collectionUrl, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    const message = `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      events: [],
      errors: [message],
      errorDetails: { fetch: [{ url: collectionUrl, message }] },
      diagnosticContext: { fetchMethod: "squarespace-events-json" },
    };
  }
  const fetchDurationMs = Date.now() - t0;

  if (!response.ok) {
    const message = `HTTP ${response.status} from ${collectionUrl}`;
    return {
      events: [],
      errors: [message],
      errorDetails: {
        fetch: [{ url: collectionUrl, status: response.status, message }],
      },
      diagnosticContext: { fetchMethod: "squarespace-events-json", fetchDurationMs },
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const message =
      `Expected JSON from ${collectionUrl} but got Content-Type "${contentType}". ` +
      "The tenant's events collection probably doesn't expose ?format=json.";
    return {
      events: [],
      errors: [message],
      errorDetails: { fetch: [{ url: collectionUrl, status: response.status, message }] },
      diagnosticContext: { fetchMethod: "squarespace-events-json", fetchDurationMs },
    };
  }

  let payload: SquarespaceEventsPayload;
  try {
    payload = (await response.json()) as SquarespaceEventsPayload;
  } catch (err) {
    const message = `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      events: [],
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      diagnosticContext: { fetchMethod: "squarespace-events-json", fetchDurationMs },
    };
  }

  // Valid JSON can still be `null` (literal "null"), a primitive, or an
  // array — none of which carry `upcoming`/`past`. Subsequent property
  // access on a non-object would throw at runtime; fail loud here instead.
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    const message = `Squarespace payload from ${collectionUrl} is not an object`;
    return {
      events: [],
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      diagnosticContext: { fetchMethod: "squarespace-events-json", fetchDurationMs },
    };
  }

  // Shape-mismatch guard. Squarespace tenants who disable the Events
  // collection (or rotate the JSON shape) return valid JSON with neither
  // `upcoming` nor `past`. If we treated that as "0 events" the reconciler
  // would silently cancel every live event for this source on the next
  // scrape. Fail loud — surface as a SCRAPE_FAILURE alert instead.
  if (!Array.isArray(payload.upcoming) && !Array.isArray(payload.past)) {
    const message =
      `Squarespace payload from ${collectionUrl} has no 'upcoming' or 'past' arrays — ` +
      "tenant may have disabled the Events collection or rotated the JSON shape.";
    return {
      events: [],
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      diagnosticContext: { fetchMethod: "squarespace-events-json", fetchDurationMs },
    };
  }

  const payloadTz = payload.website?.timeZone;
  const timezone =
    (config.timezone && isValidTimezone(config.timezone) && config.timezone) ||
    (payloadTz && isValidTimezone(payloadTz) && payloadTz) ||
    "UTC";

  const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming : [];
  const past = Array.isArray(payload.past) ? payload.past : [];
  const events = [...upcoming, ...past]
    .map((ev) => parseSquarespaceEvent(ev, config, source.url, timezone))
    .filter((ev): ev is RawEventData => ev !== null);

  return {
    events,
    errors: [],
    diagnosticContext: {
      fetchMethod: "squarespace-events-json",
      collectionUrl,
      timezone,
      upcomingCount: upcoming.length,
      pastCount: past.length,
      eventsParsed: events.length,
      eventsSkipped: upcoming.length + past.length - events.length,
      fetchDurationMs,
    },
  };
}

export class SquarespaceEventsAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(
    source: Source,
    options?: { days?: number },
  ): Promise<ScrapeResult> {
    const config = validateSourceConfig<SquarespaceEventsConfig>(
      source.config,
      "SquarespaceEventsAdapter",
      { kennelTag: "string" },
    );

    const result = await fetchSquarespaceEvents(source, config);
    const days = options?.days ?? source.scrapeDays ?? 180;
    return applyDateWindow(result, days);
  }
}
