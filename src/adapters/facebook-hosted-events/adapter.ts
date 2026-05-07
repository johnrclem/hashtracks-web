/**
 * Adapter for Facebook Page hosted_events scraping.
 *
 * Targets the dedicated `/upcoming_hosted_events` tab on a public FB Page
 * (e.g. https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events).
 * The tab serves an SSR'd HTML page that includes the GraphQL event payload
 * inline — see `parser.ts` for the JSON-island walker that extracts events.
 *
 * Logged-out fetches from server IPs return 200 with the full payload
 * (verified during planning research, 2026-05-06). The adapter therefore
 * doesn't need the residential proxy. If FB starts geo-blocking or
 * shape-rotating, the parser surfaces a 0-event result; the existing
 * EVENT_COUNT_ANOMALY health alert catches that drift after the rolling
 * baseline accrues, and the in-adapter shape-break heuristic (below)
 * catches it on first scrape before a baseline exists.
 *
 * Trust level (set on the Source row in seed): 8 — official kennel
 * posting surface, above STATIC_SCHEDULE (3).
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, ScrapeResult, RawEventData } from "../types";
import { validateSourceConfig, applyDateWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { isValidTimezone } from "@/lib/timezone";
import { parseFacebookHostedEvents, parseFacebookEventDetail } from "./parser";
import { FB_PAGE_HANDLE_RE, isReservedFacebookHandle } from "./constants";

/**
 * Headers required to get a 200 from `/upcoming_hosted_events` logged out.
 * - Browser User-Agent: bare requests get 400.
 * - Sec-Fetch-* triplet: missing these gets 400 even with a browser UA.
 *
 * Empirically determined 2026-05-07 against `GrandStrandHashing/upcoming_hosted_events`.
 * If FB tightens the bot-check and the adapter starts returning 400, this
 * object is the first thing to update — `Sec-CH-UA*` client hints are the
 * likely next addition. The pinned Chrome version is also a known staleness
 * vector; bump every ~6 months or when FB rejects the current UA.
 */
const FB_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
};

const DEFAULT_WINDOW_DAYS = 90;

/**
 * SSR markers FB ships in every hosted_events response when the GraphQL
 * shape we know is intact — both in pages with events and in empty pages.
 * If the response carries neither marker, the SSR shape has rotated and
 * our parser surface is stale; if at least one is present and we still
 * parse 0 events, the Page just genuinely has no events on this tab.
 *
 * Both markers are matched in their quoted JSON-token form so a Page
 * coincidentally mentioning either string in plain text or a comment
 * can't false-negative the shape-break check. Tightening per Gemini
 * review on PR #1295.
 *
 * Replaces the earlier byte-count heuristic (#1294 audit), which wrongly
 * flagged every 600KB+ empty-Page response as a shape break — empty FB
 * Pages still ship the full SSR bundle (Page UI, comments, photos, etc.),
 * not a stub.
 */
const FB_SSR_ENVELOPE_MARKERS = ['"RelayPrefetchedStreamCache"', '"__bbox"'] as const;

/**
 * Cap on detail-page fetches per scrape. FB doesn't aggressively rate-limit
 * but courtesy-throttling keeps us safely below any threshold. A typical
 * hash-kennel Page has 1–10 upcoming events; this cap is generous headroom.
 * The shape-break heuristic catches the case of a Page with thousands of
 * events (likely a non-kennel handle that snuck through admin validation).
 */
const MAX_DETAIL_FETCHES = 30;
/** Delay between detail-page fetches. 200ms keeps us well under the rate
 *  thresholds anonymous browsers hit; sequential fetching is also kinder
 *  to FB's edge cache than fan-out. */
const DETAIL_FETCH_DELAY_MS = 200;

/** Configuration shape for a FACEBOOK_HOSTED_EVENTS source. */
export interface FacebookHostedEventsConfig {
  /** Kennel shortName for all generated events (kennelCode). */
  kennelTag: string;
  /**
   * Page handle — the part after `https://www.facebook.com/`. Restricted
   * to FB's own allowed handle character set (alnum + dash + underscore +
   * period, 2–80 chars) so an admin typo can't redirect the fetch to an
   * unrelated URL.
   */
  pageHandle: string;
  /**
   * IANA timezone the kennel operates in. Used to project FB's unix-UTC
   * `start_timestamp` onto the canonical (kennelId, local-date) slot keys
   * the merge pipeline uses.
   */
  timezone: string;
  /**
   * Required to be `true`. The `/upcoming_hosted_events` feed drops past
   * events; the reconcile pipeline must clamp to future dates so a missing
   * past event isn't interpreted as a cancellation. The adapter rejects
   * configs where this is missing or false. Codex pass-3 finding —
   * runtime enforcement matches the admin-side `validateFacebookHostedEventsConfig`.
   */
  upcomingOnly: true;
}

/**
 * Adapter for the FB Page hosted_events tab. Single-kennel-per-source for v1
 * — most FB Pages map 1:1 to a kennel. Multi-kennel routing via
 * `kennelPatterns` is a future extension.
 */
export class FacebookHostedEventsAdapter implements SourceAdapter {
  type = "FACEBOOK_HOSTED_EVENTS" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const configResult = validateConfig(source);
    if (!configResult.ok) return errorResult(configResult.error);
    const { config } = configResult;

    const url = `https://www.facebook.com/${config.pageHandle}/upcoming_hosted_events`;
    const days = options?.days ?? DEFAULT_WINDOW_DAYS;

    let html: string;
    try {
      const res = await safeFetch(url, { headers: FB_REQUEST_HEADERS });
      if (!res.ok) return errorResult(`Facebook hosted_events fetch failed: HTTP ${res.status}`, res.status);
      html = await res.text();
    } catch (err) {
      return errorResult(`Facebook hosted_events fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Parse all events from the SSR payload. The parser is resilient to
    // shape drift (returns [] rather than throwing) so a 0-event result
    // here means EITHER the page genuinely has no upcoming events OR FB's
    // SSR shape changed.
    const allEvents = parseFacebookHostedEvents(html, {
      kennelTag: config.kennelTag,
      timezone: config.timezone,
    });

    // Shape-break heuristic: 0 parsed events AND none of FB's SSR envelope
    // markers present → the GraphQL shape rotated. If at least one marker
    // is there and we still got 0 events, the Page genuinely has nothing
    // scheduled (and that's not an alert condition). Surface as non-fatal
    // so the existing SCRAPE_FAILURE alert path catches a real shape
    // change on first scrape, without false-positive-firing on empty Pages.
    const errors: string[] = [];
    const hasEnvelopeMarker = FB_SSR_ENVELOPE_MARKERS.some((m) => html.includes(m));
    if (allEvents.length === 0 && !hasEnvelopeMarker) {
      errors.push(
        `FB hosted_events page returned ${html.length} bytes but parser found 0 events and the SSR envelope markers are absent — likely a GraphQL shape change. Refresh the parser fixture and re-test.`,
      );
    }

    // Honor options.days via the shared `applyDateWindow` so diagnostic
    // counts stay consistent with other adapters. Returns a new result
    // with `events` filtered + `totalBeforeFilter` set on diagnosticContext.
    const windowed = applyDateWindow(
      {
        events: allEvents,
        errors,
        diagnosticContext: {
          url,
          pageHandle: config.pageHandle,
          timezone: config.timezone,
          windowDays: days,
          htmlBytes: html.length,
        },
      },
      days,
    );

    // The listing tab carries structured fields but no post body; the
    // hash-run blurb (hares, shiggy, parking) lives on `/events/{id}/`.
    const enriched = await enrichWithDetails(windowed.events);
    return {
      ...windowed,
      events: enriched.events,
      errors: [...windowed.errors, ...enriched.errors],
      diagnosticContext: {
        ...windowed.diagnosticContext,
        detailFetchAttempted: enriched.attempted,
        detailFetchEnriched: enriched.enriched,
        detailFetchFailed: enriched.failed,
        ...(enriched.errorSample.length > 0
          ? { detailFetchErrorSample: enriched.errorSample }
          : {}),
      },
    };
  }
}

interface EnrichmentResult {
  events: RawEventData[];
  errors: string[];
  attempted: number;
  enriched: number;
  failed: number;
  /**
   * Up to `DETAIL_FETCH_ERROR_SAMPLE_LIMIT` short error strings from per-event
   * detail-page fetch failures. Surfaced via `diagnosticContext` so operators
   * can distinguish a 429 burst from a 404 (page deleted) from an `ECONNRESET`
   * without each failure becoming a top-level scrape error.
   */
  errorSample: string[];
}

/** Per-scrape cap on captured detail-fetch error strings. Keeps
 *  `diagnosticContext` bounded even if every detail page in a 30-event scrape
 *  fails. The first few are the most informative — we don't need 30 copies of
 *  the same `ECONNRESET`. */
const DETAIL_FETCH_ERROR_SAMPLE_LIMIT = 5;

/**
 * Sequentially fetch each event's detail page and merge `description` into
 * the RawEventData. Bounded by MAX_DETAIL_FETCHES to keep a misbehaving
 * source (or an adversarially-large hosted_events list) from running an
 * adapter into the ground; events past the cap are returned without
 * descriptions and a single warning is surfaced.
 *
 * Errors on individual fetches are swallowed (description stays absent)
 * and tallied in the diagnostic counts — a transient detail-page failure
 * shouldn't fail the whole scrape and lose the structured listing data
 * we already parsed successfully.
 */
async function enrichWithDetails(events: RawEventData[]): Promise<EnrichmentResult> {
  const errors: string[] = [];
  const targets = events.slice(0, MAX_DETAIL_FETCHES);
  if (events.length > MAX_DETAIL_FETCHES) {
    errors.push(
      `FB hosted_events page returned ${events.length} events — only the first ${MAX_DETAIL_FETCHES} were enriched with detail-page descriptions.`,
    );
  }
  const out: RawEventData[] = [];
  const errorSample: string[] = [];
  let attempted = 0;
  let enrichedCount = 0;
  let failed = 0;
  for (let i = 0; i < targets.length; i++) {
    const event = targets[i];
    const id = extractEventIdFromSourceUrl(event.sourceUrl);
    if (!id) {
      out.push(event);
      continue;
    }
    if (i > 0) await sleep(DETAIL_FETCH_DELAY_MS);
    attempted++;
    const outcome = await fetchOneEventDescription(id);
    if (outcome.kind === "enriched") {
      out.push({ ...event, description: outcome.description });
      enrichedCount++;
    } else if (outcome.kind === "no-description") {
      out.push(event);
    } else {
      // outcome.kind === "failed"
      failed++;
      if (errorSample.length < DETAIL_FETCH_ERROR_SAMPLE_LIMIT) {
        errorSample.push(`${id}: ${outcome.message.slice(0, 120)}`);
      }
      out.push(event);
    }
  }
  out.push(...events.slice(MAX_DETAIL_FETCHES));
  return { events: out, errors, attempted, enriched: enrichedCount, failed, errorSample };
}

type DetailOutcome =
  | { kind: "enriched"; description: string }
  | { kind: "no-description" }
  | { kind: "failed"; message: string };

/** Fetch + parse one detail page. Listing data integrity wins — any failure
 *  becomes a `failed` outcome rather than a thrown exception, so the caller
 *  always emits the listing event even when the detail page is gone. */
async function fetchOneEventDescription(eventId: string): Promise<DetailOutcome> {
  try {
    const html = await fetchEventDetailHtml(eventId);
    const detail = parseFacebookEventDetail(html);
    if (detail.description) return { kind: "enriched", description: detail.description };
    return { kind: "no-description" };
  } catch (err) {
    return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Extract the FB event id from a `https://www.facebook.com/events/{id}/`
 *  sourceUrl. Returns null for non-FB or malformed URLs.
 *
 *  Tolerant of URL-format drift (#1292 review): accepts a trailing slash,
 *  `?query`, `#frag`, or end-of-string after the digits, so a sourceUrl
 *  like `.../events/1012210268147290?ref=...` (no trailing slash before
 *  the query) still matches. Digit range 10–20 is generous — FB has
 *  shipped both 15- and 16-digit ids historically. */
const EVENT_ID_FROM_URL_RE = /\/events\/(\d{10,20})(?:[/?#]|$)/;
function extractEventIdFromSourceUrl(sourceUrl: string | undefined): string | null {
  if (!sourceUrl) return null;
  const m = EVENT_ID_FROM_URL_RE.exec(sourceUrl);
  return m ? m[1] : null;
}

/** Fetch a single event detail page. Throws on network errors or non-2xx
 *  responses so the caller can tally a failure without injecting a malformed
 *  HTML string into the parser. */
async function fetchEventDetailHtml(eventId: string): Promise<string> {
  const url = `https://www.facebook.com/events/${eventId}/`;
  const res = await safeFetch(url, { headers: FB_REQUEST_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ConfigValidationOk {
  ok: true;
  config: FacebookHostedEventsConfig;
}
interface ConfigValidationErr {
  ok: false;
  error: string;
}

/** Validate source.config shape + required fields. Mirrors the admin
 *  `validateFacebookHostedEventsConfig` so cron and admin reject the same
 *  malformed configs. */
function validateConfig(source: Source): ConfigValidationOk | ConfigValidationErr {
  let config: FacebookHostedEventsConfig;
  try {
    config = validateSourceConfig<FacebookHostedEventsConfig>(
      source.config,
      "FacebookHostedEventsAdapter",
      { kennelTag: "string", pageHandle: "string", timezone: "string" },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Invalid source config" };
  }
  if (!FB_PAGE_HANDLE_RE.test(config.pageHandle)) {
    return {
      ok: false,
      error: `FacebookHostedEventsAdapter: pageHandle "${config.pageHandle}" must match ${FB_PAGE_HANDLE_RE} (FB Page handles are 2–80 alnum/dash/underscore/period chars)`,
    };
  }
  if (isReservedFacebookHandle(config.pageHandle)) {
    // Belt-and-suspenders against the URL-helper bypass. Same rejection
    // the admin validator applies; this fires for non-admin write paths
    // (DB edit, seed drift, future API).
    return {
      ok: false,
      error: `FacebookHostedEventsAdapter: pageHandle "${config.pageHandle}" is a Facebook structural namespace, not a Page handle`,
    };
  }
  if (!isValidTimezone(config.timezone)) {
    return {
      ok: false,
      error: `FacebookHostedEventsAdapter: timezone "${config.timezone}" is not a recognized IANA timezone`,
    };
  }
  // Runtime invariant matching admin validation. Codex pass-3 finding —
  // any non-admin write path (seed drift, DB edit, future API) that drops
  // upcomingOnly would silently re-enable destructive reconciliation; the
  // adapter blocks it before any HTTP fetch.
  if (config.upcomingOnly !== true) {
    return {
      ok: false,
      error:
        "FacebookHostedEventsAdapter: config requires `upcomingOnly: true` (the /upcoming_hosted_events feed drops past events; reconcile must not auto-cancel them)",
    };
  }
  return { ok: true, config };
}

/** Standard ScrapeResult error envelope. Used uniformly so every error
 *  path emits the same shape (legacy `errors` flat list + structured
 *  `errorDetails.fetch[0]` for the admin alert UI). */
function errorResult(message: string, status?: number): ScrapeResult {
  return {
    events: [],
    errors: [message],
    errorDetails: { fetch: [{ message, ...(status === undefined ? {} : { status }) }] },
  };
}
