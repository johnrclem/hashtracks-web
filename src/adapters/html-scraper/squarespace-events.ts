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
   * Maximum pages to walk via Squarespace's `?offset=NNN` pagination when
   * harvesting historical events. Default 20 — sufficient for ~600 events
   * at the platform's pageSize of 30, and tenants with deeper history
   * usually hit the date-window cutoff first. Tune up for backfills.
   */
  maxPages?: number;
}

interface SquarespaceLocation {
  addressTitle?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCountry?: string | null;
  /**
   * Venue pin coordinates. CAUTION: Squarespace populates BOTH `mapLat`/`mapLng`
   * AND `markerLat`/`markerLng` for every event. When the user pins the venue
   * on the map, `mapLat`/`mapLng` reflect the pin and `markerLat`/`markerLng`
   * stay at the tenant's default position (~40.7207559, -74.0007613 — Manhattan
   * for English-language sites). When the user doesn't pin a venue,
   * `mapLat`/`mapLng` ALSO fall back to the tenant default — making them equal
   * to `markerLat`/`markerLng`. We detect the unset state by comparing the two
   * pairs (see `parseSquarespaceEvent`); without this check 16 of 38 SACH3
   * events on first scrape landed with Manhattan coords despite having
   * Sacramento street addresses.
   */
  mapLat?: number | null;
  mapLng?: number | null;
  markerLat?: number | null;
  markerLng?: number | null;
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

interface SquarespacePagination {
  nextPage?: boolean;
  nextPageOffset?: number;
  pageSize?: number;
}

interface SquarespaceEventsPayload {
  website?: { timeZone?: string; baseUrl?: string };
  upcoming?: SquarespaceEvent[];
  past?: SquarespaceEvent[];
  pagination?: SquarespacePagination;
}

/**
 * Extract venue coordinates from a Squarespace location, rejecting the
 * tenant-default pin. Squarespace populates both `mapLat`/`mapLng` and
 * `markerLat`/`markerLng` for every event; when no venue pin is set the
 * map-pair falls back to the same default as the marker-pair (typically
 * Manhattan for English-language sites). Equality between the two pairs
 * is the canonical "unset pin" signal — see SquarespaceLocation docstring.
 *
 * Comparison uses a 6-decimal epsilon (≈11cm at the equator) since both
 * pairs are stored at the same precision in the JSON payload; the float
 * comparison would otherwise be brittle against round-trip noise.
 *
 * Returns `defaultPinRejected: true` when the upstream coords were a
 * tenant default — the caller emits `dropCachedCoords: true` so the
 * merge pipeline clears any previously-stored bad pin instead of
 * preserving it via the existing-coords cache short-circuit (see #957
 * Harrier Central precedent + `RawEventData.dropCachedCoords` docs).
 */
const DEFAULT_PIN_EPSILON = 1e-6;
interface ExtractedCoords {
  latitude?: number;
  longitude?: number;
  defaultPinRejected: boolean;
}
function extractVenueCoords(loc: SquarespaceLocation): ExtractedCoords {
  const mapLat = loc.mapLat;
  const mapLng = loc.mapLng;
  if (
    typeof mapLat !== "number" ||
    typeof mapLng !== "number" ||
    !Number.isFinite(mapLat) ||
    !Number.isFinite(mapLng)
  ) {
    return { defaultPinRejected: false };
  }
  const markerLat = loc.markerLat;
  const markerLng = loc.markerLng;
  if (
    typeof markerLat === "number" &&
    typeof markerLng === "number" &&
    Math.abs(mapLat - markerLat) < DEFAULT_PIN_EPSILON &&
    Math.abs(mapLng - markerLng) < DEFAULT_PIN_EPSILON
  ) {
    // Both pairs match → user never positioned the venue. The mapLat/mapLng
    // is the tenant default, not a real venue location.
    return { defaultPinRejected: true };
  }
  return { latitude: mapLat, longitude: mapLng, defaultPinRejected: false };
}

/**
 * Pick a valid IANA timezone, preferring the source config over the
 * payload's `website.timeZone`, falling back to UTC. Extracted from the
 * main fetch flow to keep `fetchSquarespaceEvents` under Sonar's cognitive
 * complexity budget (S3776).
 */
function resolveTimezone(
  configTz: string | undefined,
  payloadTz: string | undefined,
): string {
  if (configTz && isValidTimezone(configTz)) return configTz;
  if (payloadTz && isValidTimezone(payloadTz)) return payloadTz;
  return "UTC";
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
export function resolveCollectionUrl(baseUrl: string, collectionPath: string): string {
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
 * Resolve `endDate` (different day) vs `endTime` (same day) from a
 * Squarespace event's `endDate` epoch. Extracted from
 * `parseSquarespaceEvent` so the parser stays under Sonar S3776's
 * cognitive-complexity budget; mirrors the multi-day vs same-day split
 * documented at the call site.
 *
 * Returns `{}` (both undefined) when `endDate` is missing, ≤ startDate,
 * or unparseable. Same-day → `{ endTime }`. Different-day → `{ endDate }`.
 */
function resolveEndDateOrTime(
  endMs: number | undefined,
  startMs: number,
  startDate: string,
  timezone: string,
): { endDate?: string; endTime?: string } {
  if (typeof endMs !== "number" || !Number.isFinite(endMs) || endMs <= startMs) {
    return {};
  }
  const endYmd = formatYmdInTimezone(new Date(endMs), timezone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) return {};
  if (endYmd > startDate) return { endDate: endYmd };
  return { endTime: formatLocalTime(endMs, timezone) };
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

  // Multi-day events (campouts spanning Friday → Sunday) emit `endDate`;
  // same-day events emit `endTime` instead so the EventCard renders
  // "18:30 – 21:30". See `resolveEndDateOrTime`.
  const { endDate, endTime } = resolveEndDateOrTime(event.endDate, startMs, date, timezone);

  const title = event.title?.trim() || undefined;
  const loc = event.location ?? {};
  // `decodeEntities` after `stripHtmlTags` is the documented convention
  // (`feedback_use_decode_entities`). Cheerio's `.text()` decodes most
  // entities natively, but defense-in-depth covers numeric (`&#039;`) and
  // less-common named entities that may slip through.
  const description = event.body
    ? decodeEntities(stripHtmlTags(event.body))
    : undefined;

  // Coord extraction with default-pin detection. See SquarespaceLocation
  // docstring: when the user doesn't drop a venue pin, mapLat/mapLng fall
  // back to the same tenant default as markerLat/markerLng. Treat that
  // equality as "no real coords" and emit undefined so downstream geocoding
  // can derive coords from `locationStreet` instead.
  //
  // When we DETECT and reject the default pin (defaultPinRejected=true),
  // also emit `dropCachedCoords: true` so the merge pipeline clears any
  // previously-stored bad pin. Without this flag the existing-coords cache
  // short-circuit preserves the stored Manhattan default forever (#957).
  const { latitude, longitude, defaultPinRejected } = extractVenueCoords(loc);

  // #1933: when the venue title is blank but a street address is present, fall
  // back to the composed street so the event still surfaces a displayable
  // locationName instead of rendering "venue TBD". Computed once and reused
  // for both fields so they can't diverge.
  const street = composeLocationStreet(loc);

  return {
    date,
    endDate,
    kennelTags: [config.kennelTag],
    runNumber: extractHashRunNumber(title),
    title,
    description: description || undefined,
    location: loc.addressTitle?.trim() || street || undefined,
    locationStreet: street,
    latitude,
    longitude,
    startTime: formatLocalTime(startMs, timezone),
    endTime,
    sourceUrl: resolveEventUrl(baseUrl, event.fullUrl),
    ...(defaultPinRejected ? { dropCachedCoords: true } : {}),
  };
}

/** Discriminated result of a single Squarespace page fetch. */
type PageFetchResult =
  | { ok: true; payload: SquarespaceEventsPayload; fetchDurationMs: number }
  | {
      ok: false;
      errors: string[];
      errorDetails: ErrorDetails;
      fetchDurationMs: number;
    };

/**
 * Fetch + validate one page of the Squarespace events JSON endpoint.
 * Splits out the four guard-clause error returns (network, !ok status,
 * wrong Content-Type, malformed JSON, payload-not-object, shape-mismatch)
 * so the main `fetchSquarespaceEvents` body stays under Sonar's cognitive
 * complexity budget for the pagination loop.
 */
async function fetchSquarespacePage(url: string): Promise<PageFetchResult> {
  const t0 = Date.now();
  let response: Response;
  try {
    response = await safeFetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    const message = `Fetch failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      ok: false,
      errors: [message],
      errorDetails: { fetch: [{ url, message }] },
      fetchDurationMs: Date.now() - t0,
    };
  }
  const fetchDurationMs = Date.now() - t0;

  if (!response.ok) {
    const message = `HTTP ${response.status} from ${url}`;
    return {
      ok: false,
      errors: [message],
      errorDetails: { fetch: [{ url, status: response.status, message }] },
      fetchDurationMs,
    };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    const message =
      `Expected JSON from ${url} but got Content-Type "${contentType}". ` +
      "The tenant's events collection probably doesn't expose ?format=json.";
    return {
      ok: false,
      errors: [message],
      errorDetails: { fetch: [{ url, status: response.status, message }] },
      fetchDurationMs,
    };
  }

  let payload: SquarespaceEventsPayload;
  try {
    payload = (await response.json()) as SquarespaceEventsPayload;
  } catch (err) {
    const message = `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      ok: false,
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      fetchDurationMs,
    };
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    const message = `Squarespace payload from ${url} is not an object`;
    return {
      ok: false,
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      fetchDurationMs,
    };
  }

  return { ok: true, payload, fetchDurationMs };
}

interface PaginationAccumulator {
  events: RawEventData[];
  upcomingCount: number;
  pastCount: number;
  pagesFetched: number;
  totalFetchMs: number;
  /**
   * Number of deeper-page fetches that failed during pagination. Surfaces
   * to `diagnosticContext.kennelPageFetchErrors`, which `scrape.ts`
   * consumes to suppress stale-event reconciliation — without this the
   * reconciler would treat events behind a transiently-broken offset as
   * "removed from source" and cancel them (Codex P1, #1746).
   */
  pageFetchErrors: number;
  /**
   * Non-empty string signals an INCOMPLETE pagination walk (transient
   * fetch failure, NOT the intentional maxPages cap). Surfaces to
   * `diagnosticContext.kennelPagesStopReason`; same reconciliation
   * suppression contract as `pageFetchErrors`. The maxPages cap is
   * intentional truncation and does NOT set this — events past the cap
   * are legitimately "outside our configured window".
   */
  paginationStopReason: string | null;
}

/**
 * Process one Squarespace page's events into the accumulator. Each event
 * is wrapped in try/catch so a future bug or rotated payload shape that
 * crashes `parseSquarespaceEvent` doesn't abort the whole batch.
 */
function pushPageEvents(
  payload: SquarespaceEventsPayload,
  parseEvent: (ev: SquarespaceEvent) => RawEventData | null,
  acc: PaginationAccumulator,
): void {
  const upcoming = Array.isArray(payload.upcoming) ? payload.upcoming : [];
  const past = Array.isArray(payload.past) ? payload.past : [];
  acc.upcomingCount += upcoming.length;
  acc.pastCount += past.length;
  for (const ev of [...upcoming, ...past]) {
    try {
      const parsed = parseEvent(ev);
      if (parsed) acc.events.push(parsed);
    } catch (err) {
      console.warn(
        "SquarespaceEventsAdapter: failed to parse one event row:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * Decide whether pagination should continue. Returns the next-page offset
 * or null. Returning null does NOT distinguish "no more pages" from
 * "intentional cap reached" — both are reconciliation-safe (the cap is by
 * design; the absence of `nextPage` means the source published nothing
 * deeper). Transient deeper-page failures are handled separately at the
 * call site.
 */
function getNextPageOffset(
  payload: SquarespaceEventsPayload,
  pagesFetched: number,
  maxPages: number,
): number | null {
  if (pagesFetched >= maxPages) return null;
  const pagination = payload.pagination;
  if (!pagination?.nextPage || typeof pagination.nextPageOffset !== "number") return null;
  return pagination.nextPageOffset;
}

/**
 * Walk the Squarespace `?offset=NNN` pagination chain starting from a
 * known-good first page. See helpers above for per-page processing and
 * stop-condition logic.
 */
async function walkPagination(
  firstPayload: SquarespaceEventsPayload,
  firstFetchMs: number,
  collectionUrl: string,
  maxPages: number,
  parseEvent: (ev: SquarespaceEvent) => RawEventData | null,
): Promise<PaginationAccumulator> {
  const acc: PaginationAccumulator = {
    events: [],
    upcomingCount: 0,
    pastCount: 0,
    pagesFetched: 0,
    totalFetchMs: 0,
    pageFetchErrors: 0,
    paginationStopReason: null,
  };

  let currentPayload: SquarespaceEventsPayload = firstPayload;
  let currentFetchMs = firstFetchMs;

  while (true) {
    pushPageEvents(currentPayload, parseEvent, acc);
    acc.pagesFetched++;
    acc.totalFetchMs += currentFetchMs;

    const nextOffset = getNextPageOffset(currentPayload, acc.pagesFetched, maxPages);
    if (nextOffset === null) break;

    const pageResult = await fetchSquarespacePage(appendOffset(collectionUrl, nextOffset));
    if (!pageResult.ok) {
      // Transient deeper-page failure — preserve events harvested so far
      // AND suppress stale-event reconciliation. Without the suppression
      // signal `scrape.ts` would cancel events from the unreached pages.
      acc.pageFetchErrors++;
      acc.paginationStopReason = "deeper_page_fetch_failed";
      break;
    }

    currentPayload = pageResult.payload;
    currentFetchMs = pageResult.fetchDurationMs;
  }

  return acc;
}

/**
 * Fetch + parse a Squarespace events collection, following the platform's
 * `?offset=NNN` pagination chain up to `config.maxPages` pages.
 *
 * Exported so a one-shot historical backfill script can pass a high
 * `maxPages` (or override `collectionPath`) and harvest deeper history
 * without re-implementing the per-event mapping or the shape guards.
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
  // Guard against a misconfigured `maxPages` (e.g. seeded as a string or
  // NaN). Without this, `Math.floor(NaN)` propagates and the loop's
  // `pagesFetched >= maxPages` check would always be false → on a tenant
  // that returns `nextPage: true` indefinitely the loop would never exit.
  const maxPages =
    typeof config.maxPages === "number" && Number.isFinite(config.maxPages)
      ? Math.max(1, Math.floor(config.maxPages))
      : 20;

  // First page: fail loud on shape mismatch (tenant disabled the
  // collection, etc.) so the reconciler doesn't cancel live events.
  const firstPageResult = await fetchSquarespacePage(collectionUrl);
  if (!firstPageResult.ok) {
    return {
      events: [],
      errors: firstPageResult.errors,
      errorDetails: firstPageResult.errorDetails,
      diagnosticContext: {
        fetchMethod: "squarespace-events-json",
        fetchDurationMs: firstPageResult.fetchDurationMs,
      },
    };
  }

  const firstPayload = firstPageResult.payload;
  if (!Array.isArray(firstPayload.upcoming) && !Array.isArray(firstPayload.past)) {
    const message =
      `Squarespace payload from ${collectionUrl} has no 'upcoming' or 'past' arrays — ` +
      "tenant may have disabled the Events collection or rotated the JSON shape.";
    return {
      events: [],
      errors: [message],
      errorDetails: { parse: [{ row: 0, error: message }] },
      diagnosticContext: {
        fetchMethod: "squarespace-events-json",
        fetchDurationMs: firstPageResult.fetchDurationMs,
      },
    };
  }

  const timezone = resolveTimezone(config.timezone, firstPayload.website?.timeZone);
  const acc = await walkPagination(
    firstPayload,
    firstPageResult.fetchDurationMs,
    collectionUrl,
    maxPages,
    (ev) => parseSquarespaceEvent(ev, config, source.url, timezone),
  );

  return {
    events: acc.events,
    errors: [],
    diagnosticContext: {
      fetchMethod: "squarespace-events-json",
      collectionUrl,
      timezone,
      pagesFetched: acc.pagesFetched,
      upcomingCount: acc.upcomingCount,
      pastCount: acc.pastCount,
      eventsParsed: acc.events.length,
      eventsSkipped: acc.upcomingCount + acc.pastCount - acc.events.length,
      fetchDurationMs: acc.totalFetchMs,
      // Reconciliation-suppression signals consumed by `scrape.ts:432-438`.
      // When a deeper page failed during pagination, the events we never
      // reached must NOT be cancelled — they're not gone, we just didn't
      // see them this scrape. Keys mirror Hash Rego's per-kennel-page
      // diagnostics so the existing scrape-pipeline gate works without
      // changes (Codex P1, #1746).
      kennelPageFetchErrors: acc.pageFetchErrors,
      kennelPagesStopReason: acc.paginationStopReason,
    },
  };
}

/**
 * Add or replace the `offset` query param on the collection URL so the
 * next page request preserves `format=json` (and any other tenant params).
 */
function appendOffset(collectionUrl: string, offset: number): string {
  const url = new URL(collectionUrl);
  url.searchParams.set("offset", String(offset));
  return url.toString();
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
