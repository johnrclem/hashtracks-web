import type { Source } from "@/generated/prisma/client";
import type {
  ErrorDetails,
  PaginationOutcome,
  RawEventData,
  ScrapeResult,
  SourceAdapter,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import {
  applyDateWindow,
  decodeEntities,
  extractHashRunNumber,
  stripHtmlTags,
  validateSourceConfig,
} from "../utils";
import { formatYmdInTimezone, isValidTimezone } from "@/lib/timezone";
import { withConcurrency } from "@/lib/travel/url";

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
 * `upcoming` is the complete list of future events. `past` holds only the
 * first page of past events. Do NOT walk `past` with the `?offset=NNN` chain:
 * Squarespace pages past events by `publishOn` but sorts each page by
 * `startDate`, so runs published out of order fall between pages and every
 * walk misses them. Sacramento H3 lost #1719–#1730 this way (cancelled on
 * 2026-11-05) and Von Tramp lost four Aug/Sep 2024 runs.
 *
 * Instead, fetch each calendar month with `?format=json&month=MM-YYYY`. That
 * view returns the whole month (its `past` + `upcoming`), has no pagination,
 * and echoes the filter back as `monthFilter`. A month with no events comes
 * back as `empty: true` with NO `upcoming`/`past` arrays at all. Verified live
 * 2026-11-07: the month walk is a strict superset of the offset walk on both
 * tenants.
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
}

export interface SquarespaceLocation {
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

export interface SquarespaceEvent {
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
}

interface SquarespaceEventsPayload {
  website?: { timeZone?: string; baseUrl?: string };
  upcoming?: SquarespaceEvent[];
  past?: SquarespaceEvent[];
  pagination?: SquarespacePagination;
  /** Epoch ms of the filtered month's start; present only on `?month=` responses. */
  monthFilter?: number;
  /** True on a month page with no events (which then has no arrays). */
  empty?: boolean;
  collection?: { itemCount?: number };
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
  if (!loc.addressTitle?.trim() && !loc.addressLine1?.trim() && !loc.addressLine2?.trim()) {
    // No venue text at all, yet mapLat differs from the marker: some tenants
    // carry a SECOND default pin (Von Tramp H3's sits on Grafton County, NH,
    // and every address-less trail was stored as "Warren, NH" — #2426). A pin
    // with no address can't be told apart from that default, so drop it.
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
 * Splits out the guard-clause error returns (network, !ok status, wrong
 * Content-Type, malformed JSON, payload-not-object) so the main
 * `fetchSquarespaceEvents` body stays under Sonar's cognitive complexity
 * budget.
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

/**
 * Fail-loud shape check shared by the base page and every month page. A JSON
 * page with neither array means the tenant disabled the collection or rotated
 * the shape; returning 0 events quietly would let reconcile cancel live runs.
 */
function missingArraysMessage(payload: SquarespaceEventsPayload, url: string): string | null {
  if (Array.isArray(payload.upcoming) || Array.isArray(payload.past)) return null;
  return (
    `Squarespace payload from ${url} has no 'upcoming' or 'past' arrays — ` +
    "tenant may have disabled the Events collection or rotated the JSON shape."
  );
}

/** One parse-class failure in the adapter's `errors` + `errorDetails` shape. */
function parseFailure(message: string): { errors: string[]; errorDetails: ErrorDetails } {
  return { errors: [message], errorDetails: { parse: [{ row: 0, error: message }] } };
}

/** Month pages in flight at once. One month request takes ~0.1 s. */
const MONTH_FETCH_CONCURRENCY = 4;
/** Pause before the single retry of a transient month failure. */
const MONTH_RETRY_DELAY_MS = 300;
/**
 * Ceiling on month requests per scrape (50 years). Seeded windows are far
 * smaller: Von Tramp's 3650 days is ~122 months and the Upstate backfill's
 * 9999 days is ~330. A wider window walks only the newest months and flags the
 * walk incomplete, so reconcile can't cancel the runs it skipped.
 */
const MAX_MONTH_WALK = 600;
/** Keeps the window-start Date valid for absurd `days`; past the cap anyway. */
const MAX_WINDOW_DAYS = (MAX_MONTH_WALK + 1) * 31;
const DAY_MS = 24 * 60 * 60 * 1000;

interface YearMonth {
  year: number;
  /** 1–12 */
  month: number;
}

/** "YYYY-MM-DD" → months since year 0, so month ranges are plain integer ranges. */
function toMonthIndex(ymd: string): number {
  return Number(ymd.slice(0, 4)) * 12 + Number(ymd.slice(5, 7)) - 1;
}

function fromMonthIndex(index: number): YearMonth {
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Squarespace's `month` filter value, "MM-YYYY". */
export function formatMonthParam({ year, month }: YearMonth): string {
  return `${String(month).padStart(2, "0")}-${year}`;
}

/**
 * Every calendar month, in the site timezone, from the start of the `days`
 * window through the current month, oldest first. The window start gets one
 * extra day because `applyDateWindow` compares local event dates at UTC noon
 * with `now - days`, which can reach one local day further back. Future months
 * are not listed: the base page's `upcoming` array already holds every future
 * event. Past MAX_MONTH_WALK months, only the newest are kept and `capped` is
 * set.
 *
 * Exported for unit testing.
 */
export function listWindowMonths(
  now: Date,
  days: number,
  timezone: string,
): { months: YearMonth[]; capped: boolean } {
  const span = Number.isFinite(days) && days > 0 ? Math.min(days, MAX_WINDOW_DAYS) : 0;
  const startIdx = toMonthIndex(
    formatYmdInTimezone(new Date(now.getTime() - (span + 1) * DAY_MS), timezone),
  );
  const endIdx = toMonthIndex(formatYmdInTimezone(now, timezone));
  const capped = endIdx - startIdx + 1 > MAX_MONTH_WALK;
  const firstIdx = capped ? endIdx - MAX_MONTH_WALK + 1 : startIdx;
  const months = Array.from({ length: endIdx - firstIdx + 1 }, (_, i) => fromMonthIndex(firstIdx + i));
  return { months, capped };
}

/** Set the `month` query param, keeping `format=json` and any tenant params. */
function withMonth(collectionUrl: string, monthParam: string): string {
  const url = new URL(collectionUrl);
  url.searchParams.set("month", monthParam);
  return url.toString();
}

/** One month page: the parsed payload (when there is one) and any error. */
interface MonthOutcome {
  label: string;
  payload?: SquarespaceEventsPayload;
  errors?: string[];
  errorDetails?: ErrorDetails;
}

/** A month payload problem that the walk must not swallow. */
function monthShapeError(payload: SquarespaceEventsPayload, url: string): string | null {
  if (typeof payload.monthFilter !== "number") {
    // The tenant served the unfiltered listing. Its `past` array is the
    // publishOn-paged list this walk exists to avoid.
    return `Squarespace ignored the month filter at ${url} (no monthFilter in the payload).`;
  }
  // An empty month has no arrays; anything else without them is a shape break.
  if (payload.empty !== true) {
    const missing = missingArraysMessage(payload, url);
    if (missing) return missing;
  }
  if (payload.pagination?.nextPage) {
    // Never seen live. The walk reads one page per month, so a paged month
    // would quietly drop runs.
    return `Squarespace month page ${url} is paginated (nextPage=true); runs past page 1 would be missed.`;
  }
  return null;
}

/** Network errors, 429 and 5xx are worth one retry; other failures repeat. */
function isTransientFailure(details: ErrorDetails): boolean {
  const fetchError = details.fetch?.[0];
  if (!fetchError) return false;
  const status = fetchError.status;
  return status === undefined || status === 429 || status >= 500;
}

async function fetchMonth(collectionUrl: string, ym: YearMonth): Promise<MonthOutcome> {
  const label = formatMonthParam(ym);
  const url = withMonth(collectionUrl, label);
  let page = await fetchSquarespacePage(url);
  // A walk makes up to ~120 requests per scrape; one blip shouldn't fail it.
  if (!page.ok && isTransientFailure(page.errorDetails)) {
    await new Promise((resolve) => setTimeout(resolve, MONTH_RETRY_DELAY_MS));
    page = await fetchSquarespacePage(url);
  }
  if (!page.ok) return { label, errors: page.errors, errorDetails: page.errorDetails };
  const message = monthShapeError(page.payload, url);
  // Keep whatever rows a flawed page did carry (e.g. a paginated month's first
  // page) while still failing loud. Repeats are dropped by eventKey.
  return { label, payload: page.payload, ...(message ? parseFailure(message) : {}) };
}

interface CollectState {
  events: RawEventData[];
  /** Keys of rows already taken. The base page and the month pages overlap. */
  seen: Set<string>;
  upcomingRows: number;
  pastRows: number;
  duplicateRows: number;
}

/** Stable identity for a row across the base page and month pages. */
function eventKey(ev: SquarespaceEvent): string | null {
  if (typeof ev.id === "string" && ev.id) return `id:${ev.id}`;
  if (typeof ev.fullUrl === "string" && ev.fullUrl) return `url:${ev.fullUrl}`;
  if (typeof ev.startDate === "number") return `start:${ev.startDate}|${String(ev.title ?? "")}`;
  return null;
}

/** Take a row unless an earlier page already supplied it. */
function claimRow(ev: unknown, state: CollectState): boolean {
  const key = ev && typeof ev === "object" ? eventKey(ev as SquarespaceEvent) : null;
  if (key === null) return true;
  if (state.seen.has(key)) {
    state.duplicateRows++;
    return false;
  }
  state.seen.add(key);
  return true;
}

/** Parse one page's rows into the collector, skipping rows already taken. */
function collectPayloadEvents(
  payload: SquarespaceEventsPayload,
  parseEvent: (ev: SquarespaceEvent) => RawEventData | null,
  state: CollectState,
): void {
  for (const list of ["upcoming", "past"] as const) {
    const rows = payload[list];
    if (!Array.isArray(rows)) continue;
    for (const ev of rows) {
      if (!claimRow(ev, state)) continue;
      if (list === "upcoming") state.upcomingRows++;
      else state.pastRows++;
      collectRow(ev, parseEvent, state);
    }
  }
}

/**
 * Parse one row. The try/catch keeps a future bug or rotated row shape that
 * crashes `parseSquarespaceEvent` from aborting the whole batch.
 */
function collectRow(
  ev: SquarespaceEvent,
  parseEvent: (ev: SquarespaceEvent) => RawEventData | null,
  state: CollectState,
): void {
  try {
    const parsed = parseEvent(ev);
    if (parsed) state.events.push(parsed);
  } catch (err) {
    console.warn(
      "SquarespaceEventsAdapter: failed to parse one event row:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

interface MonthWalkResult {
  failedMonths: string[];
  errors: string[];
  errorDetails: ErrorDetails;
  /** Wall-clock time for the whole walk (requests overlap). */
  fetchMs: number;
}

/**
 * Fetch every month page through a MONTH_FETCH_CONCURRENCY worker pool, then
 * collect rows oldest month first so dedup order stays deterministic. A failed
 * month does not stop the walk: the other months still yield their runs, and
 * the failure lands in `errors` so the scrape is marked FAILED and reconcile
 * is skipped.
 */
async function walkMonths(
  collectionUrl: string,
  months: YearMonth[],
  parseEvent: (ev: SquarespaceEvent) => RawEventData | null,
  state: CollectState,
): Promise<MonthWalkResult> {
  const t0 = Date.now();
  // fetchMonth never throws, so withConcurrency's abort-on-throw never fires.
  const outcomes = await withConcurrency(months, MONTH_FETCH_CONCURRENCY, (ym) =>
    fetchMonth(collectionUrl, ym),
  );
  const result: MonthWalkResult = {
    failedMonths: [],
    errors: [],
    errorDetails: {},
    fetchMs: Date.now() - t0,
  };
  for (const outcome of outcomes) {
    if (outcome.payload) collectPayloadEvents(outcome.payload, parseEvent, state);
    if (outcome.errors) {
      result.failedMonths.push(outcome.label);
      result.errors.push(...outcome.errors);
      appendErrorDetails(result.errorDetails, outcome.errorDetails ?? {});
    }
  }
  return result;
}

function appendErrorDetails(target: ErrorDetails, add: ErrorDetails): void {
  if (add.fetch?.length) target.fetch = [...(target.fetch ?? []), ...add.fetch];
  if (add.parse?.length) target.parse = [...(target.parse ?? []), ...add.parse];
}

/**
 * Non-empty when the walk is incomplete. `scrape.ts` skips reconcile on this
 * signal (shared with Hash Rego's per-kennel pages), so runs in an unread
 * month are never cancelled.
 */
function walkStopReason(walk: MonthWalkResult, capped: boolean): string | null {
  if (walk.failedMonths.length > 0) return "month_fetch_failed";
  if (capped) return "month_walk_capped";
  return null;
}

/**
 * Fetch + parse a Squarespace events collection: the base page (complete
 * `upcoming` list, site timezone) plus one `?month=MM-YYYY` page for every
 * month from the start of the `days` window through the current month.
 *
 * Exported so a one-shot historical backfill script can pass a wide `days`
 * window (or override `collectionPath`) without re-implementing the per-event
 * mapping or the shape guards.
 */
export async function fetchSquarespaceEvents(
  source: Source,
  config: SquarespaceEventsConfig,
  days: number,
  now: Date = new Date(),
): Promise<ScrapeResult> {
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

  // Base page: fail loud on shape mismatch (tenant disabled the collection,
  // etc.) so the reconciler doesn't cancel live events.
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
  const shapeMessage = missingArraysMessage(firstPayload, collectionUrl);
  if (shapeMessage) {
    return {
      events: [],
      ...parseFailure(shapeMessage),
      diagnosticContext: {
        fetchMethod: "squarespace-events-json",
        fetchDurationMs: firstPageResult.fetchDurationMs,
      },
    };
  }

  const timezone = resolveTimezone(config.timezone, firstPayload.website?.timeZone);
  const parseEvent = (ev: SquarespaceEvent) =>
    parseSquarespaceEvent(ev, config, source.url, timezone);
  const state: CollectState = {
    events: [],
    seen: new Set(),
    upcomingRows: 0,
    pastRows: 0,
    duplicateRows: 0,
  };
  collectPayloadEvents(firstPayload, parseEvent, state);

  const { months, capped } = listWindowMonths(now, days, timezone);
  const walk = await walkMonths(collectionUrl, months, parseEvent, state);
  const rowsSeen = state.upcomingRows + state.pastRows;
  const pagination: PaginationOutcome = {
    kennelPageFetchErrors: walk.failedMonths.length,
    kennelPagesStopReason: walkStopReason(walk, capped),
  };

  return {
    events: state.events,
    errors: walk.errors,
    errorDetails: hasAnyErrors(walk.errorDetails) ? walk.errorDetails : undefined,
    pagination,
    diagnosticContext: {
      fetchMethod: "squarespace-events-json",
      collectionUrl,
      timezone,
      monthsRequested: months.length,
      monthsFetched: months.length - walk.failedMonths.length,
      monthRange: `${formatMonthParam(months[0])}..${formatMonthParam(months.at(-1) as YearMonth)}`,
      failedMonths: walk.failedMonths,
      // Every event in the collection, any date. Compare with
      // upcomingCount + pastCount when the window covers the whole archive.
      collectionItemCount: firstPayload.collection?.itemCount ?? null,
      upcomingCount: state.upcomingRows,
      pastCount: state.pastRows,
      duplicateRows: state.duplicateRows,
      eventsParsed: state.events.length,
      eventsSkipped: rowsSeen - state.events.length,
      fetchDurationMs: firstPageResult.fetchDurationMs + walk.fetchMs,
      ...pagination,
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

    const days = options?.days ?? source.scrapeDays ?? 180;
    const result = await fetchSquarespaceEvents(source, config, days);
    return applyDateWindow(result, days);
  }
}
