/**
 * Adapter for Facebook Page hosted_events scraping.
 *
 * Targets the dedicated `/upcoming_hosted_events` tab on a public FB Page
 * (e.g. https://www.facebook.com/GrandStrandHashing/upcoming_hosted_events).
 * The tab serves an SSR'd HTML page that includes the GraphQL event payload
 * inline — see `parser.ts` for the JSON-island walker that extracts events.
 *
 * Logged-out fetches from server IPs USED to return 200 with the full
 * payload, but FB now serves a checkpoint / "content isn't available"
 * interstitial to some Pages from datacenter IPs (Vercel) — HTTP 200, zero
 * event nodes (#1939). The adapter therefore fetches direct first and, when
 * the response `looksLikeFbBlock`, retries once through the NAS residential
 * proxy (residential IPs aren't checkpointed). A source can also set
 * `useResidentialProxy: true` to skip the wasted direct attempt. If both the
 * direct and proxy attempts are blocked the adapter surfaces a shape-break /
 * checkpoint error (a FAILED scrape, not "0 events") so reconcile won't run.
 *
 * `includePastEvents: true` additionally fetches `/past_hosted_events` to
 * backfill rich title/venue for events that aged off the upcoming tab before
 * they were ever scraped (#1940). Past events are reconcile-safe because
 * reconcile clamps its cancellation window to the future under
 * `upcomingOnly: true` (see reconcile.ts); they are enrichment-only.
 *
 * Trust level (set on the Source row in seed): 8 — official kennel
 * posting surface, above STATIC_SCHEDULE (3).
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, ScrapeResult, RawEventData } from "../types";
import { validateSourceConfig, applyDateWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { isValidTimezone, formatYmdInTimezone } from "@/lib/timezone";
import {
  parseFacebookHostedEventsWithStats,
  parseFacebookEventDetail,
  extractFieldsFromFbDescription,
  looksLikeFbBlock,
  FB_SSR_ENVELOPE_MARKERS,
} from "./parser";
import { FB_PAGE_HANDLE_RE, isReservedFacebookHandle } from "./constants";
import type { KennelPattern } from "../kennel-patterns";

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
 * Default backward window for `includePastEvents` (#1940). FB's logged-out
 * past tab is itself shallow (typically the most recent page of events), so
 * this generous bound mostly just guards against a Page with an unusually
 * deep past feed; tune per-source via `config.pastWindowDays`.
 */
const DEFAULT_PAST_WINDOW_DAYS = 365;

/**
 * SSR envelope markers + the `looksLikeFbBlock` checkpoint heuristic now live
 * in `parser.ts` (imported above) so the shape-break error logic here and the
 * residential-proxy retry heuristic share one source of truth.
 */

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
  /**
   * Default kennel shortName (kennelCode). Tags every event for a
   * single-kennel source, and is the fallback for events matching no
   * `kennelPatterns` entry (alongside `defaultKennelTag`).
   */
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
  /**
   * Force the listing + detail fetches through the NAS residential proxy
   * from the first attempt, skipping the direct fetch (#1939). Set for Pages
   * known to be checkpoint-blocked from datacenter IPs (Survivor H3, Von
   * Tramp). When omitted/false the adapter still falls back to the proxy
   * automatically if the direct fetch `looksLikeFbBlock` — this flag just
   * avoids the wasted round-trip for chronically-blocked Pages.
   */
  useResidentialProxy?: boolean;
  /**
   * Also fetch `/past_hosted_events` and merge those events in (#1940).
   * Backfills rich title/venue for events that aged off the upcoming tab
   * before they were ever scraped (their canonical otherwise shows the
   * STATIC_SCHEDULE placeholder). Reconcile-safe: `upcomingOnly: true` keeps
   * reconcile's cancellation window in the future, so past events are
   * enrichment-only and never cancelled. Past events use listing-tab fields
   * only — no per-event detail-page enrichment. Default false.
   */
  includePastEvents?: boolean;
  /**
   * Backward window (days) for `includePastEvents`. Past events older than
   * this are dropped. Defaults to {@link DEFAULT_PAST_WINDOW_DAYS}. No-op
   * without `includePastEvents`.
   */
  pastWindowDays?: number;
  /**
   * Optional per-event kennel routing (#1996) for FB Pages that host a
   * sister kennel's events. Each event's name is matched against these
   * patterns via the shared `matchKennelPatterns` engine (same grammar
   * GOOGLE_CALENDAR uses). Omit for single-kennel sources — every event is
   * then tagged `kennelTag`, unchanged from pre-#1996 behavior.
   */
  kennelPatterns?: KennelPattern[];
  /** Fallback kennelTag for events matching no `kennelPatterns` entry.
   *  Defaults to `kennelTag`. No-op without `kennelPatterns`. */
  defaultKennelTag?: string;
  /**
   * Optional per-source title strips (#2158) for Pages whose FB event names
   * carry a fixed kennel-name prefix / templated suffix that isn't part of the
   * actual title (e.g. Hollyweird's `Hollyweird Hash House Harriers, … ~ aka:
   * H6#311`). Same grammar GOOGLE_CALENDAR uses; each pattern is `.replace()`-d
   * out of the stored title. Applied after run-number extraction, so an embedded
   * `H6#311` still yields a runNumber. Omit for sources without the issue.
   */
  titleStripPatterns?: string[];
}

/**
 * Adapter for the FB Page hosted_events tab. Most FB Pages map 1:1 to a
 * kennel (just set `kennelTag`). Pages that host a sister kennel's events
 * can route per-event via `config.kennelPatterns` (#1996), matched against
 * each event name through the shared `matchKennelPatterns` engine — the same
 * mechanism GOOGLE_CALENDAR uses.
 */
export class FacebookHostedEventsAdapter implements SourceAdapter {
  type = "FACEBOOK_HOSTED_EVENTS" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const configResult = validateConfig(source);
    if (!configResult.ok) return errorResult(configResult.error);
    const { config } = configResult;

    const url = `https://www.facebook.com/${config.pageHandle}/upcoming_hosted_events`;
    const days = options?.days ?? DEFAULT_WINDOW_DAYS;
    const forceProxy = config.useResidentialProxy === true;

    // Fetch the upcoming tab, falling back to the residential proxy when the
    // direct attempt is blocked / fails (#1939). A terminal failure here is a
    // FAILED scrape (reconcile won't run), which is the correct behavior —
    // an unreachable Page must not be read as "0 upcoming events".
    let html: string;
    let usedProxy: boolean;
    // Set when a proxy retry was attempted but threw, and we fell back to the
    // (blocked) direct body — so the checkpoint error can name the proxy cause.
    let proxyError: string | undefined;
    try {
      const fetched = await fetchFbListing(url, { forceProxy });
      html = fetched.html;
      usedProxy = fetched.usedProxy;
      proxyError = fetched.proxyError;
    } catch (err) {
      return errorResult(`Facebook hosted_events fetch error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Parse all events from the SSR payload. The parser is resilient to
    // shape drift (returns [] rather than throwing) so a 0-event result
    // here means EITHER the page genuinely has no upcoming events OR FB's
    // SSR shape changed OR a checkpoint/login wall slipped through.
    const parseResult = parseFacebookHostedEventsWithStats(html, {
      kennelTag: config.kennelTag,
      timezone: config.timezone,
      // Optional routing — undefined when single-kennel, handled by the parser.
      kennelPatterns: config.kennelPatterns,
      defaultKennelTag: config.defaultKennelTag,
      titleStripPatterns: config.titleStripPatterns,
    });
    const allEvents = parseResult.events;
    const filteredCounts = parseResult.filtered;
    // Only `admin-notice` and `placeholder` reflect content-quality drops
    // ("this Page admin posts non-trails on the events feed"). The other
    // reject reasons (missing-half, no-title, invalid-time, cancelled)
    // reflect shape drift or normal cancellations and must NOT raise the
    // coverage-gap signal — those would create false alerts on Pages with
    // legitimate cancelled events or partial graph payloads (Codex P1).
    const contentFilteredTotal = filteredCounts["admin-notice"] + filteredCounts.placeholder;

    // Block / shape-break heuristic on the FINAL html (after any proxy retry).
    // 0 parsed events AND the page `looksLikeFbBlock` (envelope markers absent
    // — a rotated GraphQL shape or a checkpoint wall — or a checkpoint marker
    // present) → surface a non-fatal error so the SCRAPE_FAILURE / health path
    // catches it on first scrape and reconcile is skipped (events.length is 0
    // anyway). A genuinely-empty but healthy Page ships the envelope and trips
    // neither, so this stays silent there (#1939). When the proxy retry was
    // attempted and still blocked, the message says so.
    const errors: string[] = [];
    const hasEnvelopeMarker = FB_SSR_ENVELOPE_MARKERS.some((m) => html.includes(m));
    const blocked = looksLikeFbBlock(html);
    if (allEvents.length === 0 && blocked) {
      // Name the proxy outcome: it threw (proxyError), or it ran and stayed
      // blocked (usedProxy), or it wasn't attempted.
      const proxySuffix = proxyError
        ? `; residential-proxy retry failed: ${proxyError}`
        : usedProxy
          ? "; residential-proxy retry did not clear it"
          : "";
      errors.push(
        `FB hosted_events page returned ${html.length} chars but parser found 0 events and the page looks like a checkpoint/login wall or a GraphQL shape change (SSR envelope markers ${hasEnvelopeMarker ? "present" : "absent"})${proxySuffix}. Treat as a fetch failure, not 0 events — verify the Page is reachable / refresh the parser fixture.`,
      );
    } else if (allEvents.length === 0 && hasEnvelopeMarker && contentFilteredTotal > 0) {
      // Coverage-gap signal (#1496, #1499): SSR envelope intact AND at least
      // one event candidate was content-filtered (admin notices, placeholder
      // rows) and zero real events made it through. Distinct from "Page
      // genuinely has nothing scheduled" — worth surfacing so an operator can
      // re-evaluate the FB source vs. switching to MEETUP / website / static.
      const reasonSummary = (["admin-notice", "placeholder"] as const)
        .filter((reason) => filteredCounts[reason] > 0)
        .map((reason) => `${reason}=${filteredCounts[reason]}`)
        .join(", ");
      errors.push(
        `FB hosted_events page returned ${contentFilteredTotal} candidate events but all were content-filtered (${reasonSummary}). Source likely does not use FB Hosted Events for runs — consider replacing with a website / Meetup source.`,
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
          parserFiltered: filteredCounts,
          usedResidentialProxy: usedProxy,
          ...(proxyError !== undefined ? { proxyError } : {}),
        },
      },
      days,
    );

    // The listing tab carries structured fields but no post body; the
    // hash-run blurb (hares, shiggy, parking) lives on `/events/{id}/`.
    // Detail + past fetches reuse the proxy when the listing needed it.
    // `usedProxy` already implies `forceProxy` (the forceProxy branch of
    // fetchFbListing returns usedProxy:true), so it's the single source of
    // truth for "did this scrape need the proxy?".
    const enriched = await enrichWithDetails(windowed.events, { useProxy: usedProxy });

    // Past-events backfill (#1940). Best-effort and isolated: a past-tab
    // failure is recorded in diagnostics only — never added to top-level
    // `errors[]`, which would (wrongly) disable reconcile of future events.
    // Past events use listing-tab fields only.
    //
    // GATE on the upcoming tab having ≥1 in-window event. scrape.ts skips
    // reconcile entirely when a scrape returns 0 events (the transient-empty
    // protection for upcoming-only feeds). If past events flipped that scrape
    // from empty→non-empty while the upcoming tab was momentarily empty,
    // reconcile would run with zero future events scraped and false-cancel a
    // sole-source future canonical that FB just briefly dropped. Only
    // backfilling past events when there's at least one upcoming event keeps
    // the reconcile guard behaving exactly as it did pre-#1940 (and past data
    // is historical, so deferring it to the next non-empty scrape is harmless).
    const past =
      config.includePastEvents && enriched.events.length > 0
        ? await fetchPastEvents(config, usedProxy)
        : { events: [], diagnostic: undefined };

    // Merge upcoming + past, deduping by FB event id so an event appearing on
    // both tabs (e.g. "today") keeps its enriched upcoming copy.
    const combinedEvents = dedupeByEventId([...enriched.events, ...past.events]);

    return {
      ...windowed,
      events: combinedEvents,
      errors: [...windowed.errors, ...enriched.errors],
      diagnosticContext: {
        ...windowed.diagnosticContext,
        detailFetchAttempted: enriched.attempted,
        detailFetchEnriched: enriched.enriched,
        detailFetchFailed: enriched.failed,
        ...(enriched.errorSample.length > 0
          ? { detailFetchErrorSample: enriched.errorSample }
          : {}),
        ...(past.diagnostic ? { pastFetch: past.diagnostic } : {}),
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
/**
 * Mine structured fields (#1319) out of the post body and merge into the
 * event. Only backfills fields the parser hasn't already populated, so a
 * future adapter-side emit (or a richer listing-tab GraphQL field) wins.
 */
function applyDetailDescription(event: RawEventData, description: string): RawEventData {
  const extra = extractFieldsFromFbDescription(description);
  return {
    ...event,
    description,
    // `extra.hares` is tri-state: string (real), null (explicit clear, #2032
    // self-heal), or undefined (no signal). Backfill when the listing pass left
    // hares unset and the body produced any signal — `!== undefined` carries the
    // null clear through, where a truthy check would drop it.
    ...(event.hares === undefined && extra.hares !== undefined ? { hares: extra.hares } : {}),
    ...(event.locationStreet === undefined && extra.locationStreet
      ? { locationStreet: extra.locationStreet }
      : {}),
    // #1930: cost / difficulty / prelube mined from the post body. Only
    // backfill when the listing pass left them unset (it always does today).
    ...(event.cost === undefined && extra.cost !== undefined ? { cost: extra.cost } : {}),
    ...(event.difficulty === undefined && extra.difficulty !== undefined
      ? { difficulty: extra.difficulty }
      : {}),
    ...(event.prelube === undefined && extra.prelube !== undefined
      ? { prelube: extra.prelube }
      : {}),
  };
}

interface DetailFetchOutcome {
  event: RawEventData;
  attempted: number;
  enriched: number;
  failed: number;
  /** Optional error sample line ("eventId: message") to record. */
  errorLine?: string;
}

/** Fetch one event's detail page, parse the description, and merge fields. */
async function fetchAndMergeDetail(event: RawEventData, useProxy: boolean): Promise<DetailFetchOutcome> {
  const id = extractEventIdFromSourceUrl(event.sourceUrl);
  if (!id) return { event, attempted: 0, enriched: 0, failed: 0 };
  const outcome = await fetchOneEventDescription(id, useProxy);
  if (outcome.kind === "enriched") {
    return { event: applyDetailDescription(event, outcome.description), attempted: 1, enriched: 1, failed: 0 };
  }
  if (outcome.kind === "no-description") {
    return { event, attempted: 1, enriched: 0, failed: 0 };
  }
  return {
    event,
    attempted: 1,
    enriched: 0,
    failed: 1,
    errorLine: `${id}: ${outcome.message.slice(0, 120)}`,
  };
}

async function enrichWithDetails(
  events: RawEventData[],
  opts: { useProxy: boolean },
): Promise<EnrichmentResult> {
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
    if (i > 0) await sleep(DETAIL_FETCH_DELAY_MS);
    const outcome = await fetchAndMergeDetail(targets[i], opts.useProxy);
    out.push(outcome.event);
    attempted += outcome.attempted;
    enrichedCount += outcome.enriched;
    failed += outcome.failed;
    if (outcome.errorLine && errorSample.length < DETAIL_FETCH_ERROR_SAMPLE_LIMIT) {
      errorSample.push(outcome.errorLine);
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
async function fetchOneEventDescription(eventId: string, useProxy: boolean): Promise<DetailOutcome> {
  try {
    const html = await fetchEventDetailHtml(eventId, useProxy);
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
 *  HTML string into the parser. Routes through the residential proxy when the
 *  listing fetch needed it (#1939). */
async function fetchEventDetailHtml(eventId: string, useProxy: boolean): Promise<string> {
  const url = `https://www.facebook.com/events/${eventId}/`;
  return fetchVia(url, useProxy);
}

/** Single GET with the FB headers, optionally through the residential proxy.
 *  Throws on network errors or non-2xx so callers fail loud. */
async function fetchVia(url: string, useResidentialProxy: boolean): Promise<string> {
  const res = await safeFetch(url, {
    headers: FB_REQUEST_HEADERS,
    ...(useResidentialProxy ? { useResidentialProxy: true } : {}),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface FbListingFetch {
  html: string;
  /** Whether the returned HTML came back through the residential proxy. */
  usedProxy: boolean;
  /**
   * Set only when a proxy retry was attempted and THREW, but we fell back to a
   * (blocked) direct 200 body so the adapter can still emit a precise
   * checkpoint error. Lets that error name the proxy failure instead of
   * silently swallowing it (#2267 review).
   */
  proxyError?: string;
}

/**
 * Fetch a hosted_events listing tab (upcoming or past), falling back to the
 * NAS residential proxy when the direct attempt is blocked (#1939).
 *
 * FB serves a checkpoint / "content isn't available" wall to some Pages from
 * datacenter IPs — HTTP 200 with zero event nodes — and also occasionally a
 * hard 403/timeout. We detect both:
 *   - a direct 200 whose body `looksLikeFbBlock` (envelope markers absent or a
 *     checkpoint marker present), or
 *   - a non-2xx / network error,
 * and retry once through the residential proxy (residential IPs aren't
 * checkpointed). `forceProxy` skips the wasted direct attempt for Pages known
 * to be chronically blocked.
 *
 * Throws only when there is no usable HTML to return (both attempts failed and
 * we never got a 200 body). A direct 200-but-blocked body is returned as a
 * last resort when the proxy also fails, so the caller can surface the precise
 * checkpoint error rather than an opaque fetch throw.
 */
async function fetchFbListing(url: string, opts: { forceProxy: boolean }): Promise<FbListingFetch> {
  if (opts.forceProxy) {
    return { html: await fetchVia(url, true), usedProxy: true };
  }

  let directHtml: string | null = null;
  let directErr = "blocked";
  try {
    const res = await safeFetch(url, { headers: FB_REQUEST_HEADERS });
    if (res.ok) {
      directHtml = await res.text();
      if (!looksLikeFbBlock(directHtml)) return { html: directHtml, usedProxy: false };
      // 200 but a checkpoint/login wall — fall through to the proxy retry.
    } else {
      directErr = `HTTP ${res.status}`;
    }
  } catch (err) {
    directErr = err instanceof Error ? err.message : String(err);
  }

  try {
    return { html: await fetchVia(url, true), usedProxy: true };
  } catch (proxyErr) {
    // Proxy failed too. If the direct attempt at least gave us a (blocked) 200
    // body, return it so the adapter emits the checkpoint error; otherwise
    // there's nothing to parse — throw with both failure reasons.
    const detail = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
    if (directHtml !== null) return { html: directHtml, usedProxy: false, proxyError: detail };
    throw new Error(`direct (${directErr}) and residential-proxy (${detail}) both failed`);
  }
}

interface PastEventsResult {
  events: RawEventData[];
  diagnostic?: Record<string, unknown>;
}

/**
 * Fetch + parse `/past_hosted_events` for the backward-window backfill (#1940).
 * Best-effort: any failure is captured in the returned diagnostic and the
 * events list stays empty — the caller must NOT promote a past-tab failure to
 * a top-level scrape error (that would disable reconcile of future events).
 *
 * Past events use listing-tab fields only (title/venue/run#/coords) — the
 * #1940 symptom is the placeholder title/venue, which the listing tab carries.
 * Skipping detail-page enrichment keeps this to one extra GET per scrape.
 *
 * `forceProxy` is the upcoming fetch's `usedProxy`: when the upcoming tab
 * already needed the residential proxy, the past tab is blocked from the same
 * IP too, so skip the guaranteed-to-fail direct attempt. When false, the past
 * fetch still falls back to the proxy on its own if it `looksLikeFbBlock`.
 */
async function fetchPastEvents(
  config: FacebookHostedEventsConfig,
  forceProxy: boolean,
): Promise<PastEventsResult> {
  const url = `https://www.facebook.com/${config.pageHandle}/past_hosted_events`;
  const pastWindowDays =
    typeof config.pastWindowDays === "number" && config.pastWindowDays > 0
      ? config.pastWindowDays
      : DEFAULT_PAST_WINDOW_DAYS;
  try {
    const { html, usedProxy } = await fetchFbListing(url, { forceProxy });
    const parsed = parseFacebookHostedEventsWithStats(html, {
      kennelTag: config.kennelTag,
      timezone: config.timezone,
      kennelPatterns: config.kennelPatterns,
      defaultKennelTag: config.defaultKennelTag,
      titleStripPatterns: config.titleStripPatterns,
    });
    // Explicit BACKWARD-only window [earliest, today) in the kennel's zone.
    // The upcoming tab owns today + future, so strictly-before `today` avoids
    // double-counting (dedup-by-id is the backstop); `earliest` bounds how far
    // back we backfill. Computed directly rather than via the symmetric
    // `filterEventsByWindow` so the asymmetric intent can't silently regress.
    const today = formatYmdInTimezone(new Date(), config.timezone);
    const earliest = formatYmdInTimezone(
      new Date(Date.now() - pastWindowDays * 24 * 60 * 60 * 1000),
      config.timezone,
    );
    const pastOnly = parsed.events.filter((e) => e.date >= earliest && e.date < today);
    return {
      events: pastOnly,
      diagnostic: {
        url,
        usedResidentialProxy: usedProxy,
        htmlBytes: html.length,
        parsed: parsed.events.length,
        kept: pastOnly.length,
        windowDays: pastWindowDays,
      },
    };
  } catch (err) {
    return {
      events: [],
      diagnostic: { url, error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Dedup events by FB event id (from sourceUrl), keeping the first occurrence.
 * Callers pass upcoming events first so an event present on both the upcoming
 * and past tabs keeps its (possibly detail-enriched) upcoming copy. Events
 * with no extractable id are all kept (can't tell them apart).
 */
function dedupeByEventId(events: RawEventData[]): RawEventData[] {
  const seen = new Set<string>();
  const out: RawEventData[] = [];
  for (const event of events) {
    const id = extractEventIdFromSourceUrl(event.sourceUrl);
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(event);
  }
  return out;
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
