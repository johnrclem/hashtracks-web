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
import type { SourceAdapter, ScrapeResult } from "../types";
import { validateSourceConfig, applyDateWindow } from "../utils";
import { safeFetch } from "../safe-fetch";
import { isValidTimezone } from "@/lib/timezone";
import { parseFacebookHostedEvents } from "./parser";
import { FB_PAGE_HANDLE_RE } from "./constants";

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
/** Below this byte count, an empty parse result is the legit "no upcoming
 *  events" page. Above it (with 0 events) the SSR shape almost certainly
 *  rotated and the parser-fixture needs refreshing. Calibrated against the
 *  ~900KB GSH3 fixture; FB's empty-page response is well under 50KB. */
const SHAPE_BREAK_BYTES = 200_000;

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

    // Shape-break heuristic: a real "no upcoming events" page is small
    // (FB ships <50KB when the events list is empty). A 200-OK page with
    // a fat payload but 0 parsed events almost certainly means the SSR
    // GraphQL shape rotated. Surface as a non-fatal error so the existing
    // SCRAPE_FAILURE alert path catches it on first scrape — without
    // requiring the EVENT_COUNT_ANOMALY rolling baseline.
    const errors: string[] = [];
    if (allEvents.length === 0 && html.length > SHAPE_BREAK_BYTES) {
      errors.push(
        `FB hosted_events page returned ${html.length} bytes but parser found 0 events — likely SSR GraphQL shape change. Refresh the parser fixture and re-test.`,
      );
    }

    // Honor options.days via the shared `applyDateWindow` so diagnostic
    // counts stay consistent with other adapters. Returns a new result
    // with `events` filtered + `totalBeforeFilter` set on diagnosticContext.
    return applyDateWindow(
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
  }
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
    errorDetails: { fetch: [{ message, ...(status !== undefined ? { status } : {}) }] },
  };
}
