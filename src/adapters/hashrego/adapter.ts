import type { Source } from "@/generated/prisma/client";
import type {
  SourceAdapter,
  RawEventData,
  ScrapeResult,
  ErrorDetails,
  ParseError,
} from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { generateStructureHash } from "@/pipeline/structure-hash";
import {
  parseEventsIndex,
  parseEventDetail,
  splitToRawEvents,
  parseHashRegoDate,
  parseHashRegoTime,
  type IndexEntry,
} from "./parser";
import {
  fetchKennelEvents,
  kennelEventsUrl,
  eventDetailUrl,
  HASHREGO_EVENTS_INDEX_URL,
  HashRegoApiError,
  HASHREGO_ISO_DATETIME_RE,
  type HashRegoKennelEvent,
} from "./api";

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 500;
const LOOKBACK_DAYS = 7;
const INDEX_FETCH_RETRIES = 2;
const STEP2B_BUDGET_MS = 45_000;
const MAX_REQUEST_TIMEOUT_MS = 5_000;
const MIN_REQUEST_TIMEOUT_MS = 800;
import { USER_AGENT } from "./constants";

/**
 * Hash Rego adapter — scrapes hashrego.com event listings.
 *
 * Strategy:
 * 1. Fetch the events index page (HTML table with all upcoming events)
 * 2. Filter to events from configured kennel slugs + date range
 * 3. Fetch matching event detail pages in parallel batches
 * 4. Parse into RawEventData entries (splitting multi-day events)
 */
export class HashRegoAdapter implements SourceAdapter {
  type = "HASHREGO" as const;

  async fetch(
    source: Source,
    options?: { days?: number; kennelSlugs?: string[] },
  ): Promise<ScrapeResult> {
    const slugList = options?.kennelSlugs ?? [];
    if (slugList.length === 0) {
      return { events: [], errors: ["No kennel slugs provided — check SourceKennel.externalSlug is populated for this source"] };
    }
    const kennelSlugs = new Set(slugList.map((s) => s.toUpperCase()));

    const events: RawEventData[] = [];
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();
    let detailPagesFetched = 0;
    let detailPagesFailed = 0;

    // Step 1: Fetch events index (with retry for transient failures)
    let indexHtml: string | undefined;
    const maxAttempts = 1 + INDEX_FETCH_RETRIES;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await safeFetch(HASHREGO_EVENTS_INDEX_URL, {
          headers: { "User-Agent": USER_AGENT },
          useResidentialProxy: true,
          signal: AbortSignal.timeout(30_000),
        });
        if (res.ok) {
          indexHtml = await res.text();
          break;
        }
        await res.body?.cancel();
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        const msg = `Index fetch failed: HTTP ${res.status} (after ${maxAttempts} attempts)`;
        errorDetails.fetch = [{ url: HASHREGO_EVENTS_INDEX_URL, status: res.status, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      } catch (err) {
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 1000 * attempt));
          continue;
        }
        const msg = `Index fetch error: ${err}`;
        errorDetails.fetch = [{ url: HASHREGO_EVENTS_INDEX_URL, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }
    }

    const structureHash = generateStructureHash(indexHtml!);

    // Step 2: Parse index, filter by kennel slugs + date range
    const allEntries = parseEventsIndex(indexHtml!);
    const days = options?.days ?? 90;
    const now = new Date();
    const lookbackDate = new Date(now);
    lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
    const cutoffDate = new Date(now);
    cutoffDate.setDate(cutoffDate.getDate() + days);

    const isInDateWindow = (dateStr: string) => {
      const date = parseHashRegoDate(dateStr);
      if (!date) return true; // Keep unparseable dates (let detail page try)
      const eventDate = new Date(date + "T12:00:00Z");
      return eventDate >= lookbackDate && eventDate <= cutoffDate;
    };

    const matchingEntries = allEntries.filter((e) =>
      kennelSlugs.has(e.kennelSlug.toUpperCase()) && isInDateWindow(e.startDate),
    );

    // Step 2b: Fetch kennel events from the JSON API for slugs absent from
    // the global HTML index. Bounded-concurrent batches with remaining-budget-
    // aware per-call timeouts so the outer cron timeout stays safe when the
    // API is degraded.
    const globalIndexSlugs = new Set(allEntries.map((e) => e.kennelSlug.toUpperCase()));
    const missingSlugs = [...kennelSlugs].filter((s) => !globalIndexSlugs.has(s));
    const kennelPagesChecked: string[] = [];
    let kennelPageEventsFound = 0;
    const existingSlugs = new Set(matchingEntries.map((e) => e.slug));
    let kennelPageFetchErrors = 0;
    let kennelPagesStopReason: string | null = null;

    for (let i = 0; i < missingSlugs.length; i += BATCH_SIZE) {
      const remaining = STEP2B_BUDGET_MS - (Date.now() - fetchStart);
      if (remaining < MIN_REQUEST_TIMEOUT_MS) {
        kennelPagesStopReason = "budget_exhausted";
        break;
      }
      // Halve remaining so the next iteration of this loop has breathing room
      // to fire the budget guard cleanly instead of racing the outer cron.
      const perCallTimeout = Math.min(MAX_REQUEST_TIMEOUT_MS, Math.floor(remaining / 2));
      const batch = missingSlugs.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (slug) => ({
          slug,
          outcome: await fetchAndConvertKennelEvents(slug, perCallTimeout),
        })),
      );

      for (const { slug, outcome } of results) {
        kennelPagesChecked.push(slug);
        if (outcome.kind === "fail") {
          const status = outcome.error.status;
          errorDetails.fetch ??= [];
          errorDetails.fetch.push({
            url: kennelEventsUrl(slug),
            status: status === 0 ? undefined : status,
            message: outcome.error.message,
          });
          kennelPageFetchErrors++;
          // Whole-response parse drift (malformed JSON, non-array body) is a
          // data-loss path: the entire kennel call returns no events even
          // though the HTTP fetch succeeded. Match Step 3 parse-surface
          // semantics by pushing to errors[] so the scrape is marked failed
          // and reconcile is blocked.
          if (outcome.error.kind === "parse") {
            errors.push(outcome.error.message);
          }
          continue;
        }
        for (const entry of outcome.entries) {
          if (!existingSlugs.has(entry.slug) && isInDateWindow(entry.startDate)) {
            existingSlugs.add(entry.slug);
            matchingEntries.push(entry);
            kennelPageEventsFound++;
          }
        }
        if (outcome.rowParseErrors.length > 0) {
          errorDetails.parse ??= [];
          errorDetails.parse.push(...outcome.rowParseErrors);
          // Push each row's parse error text into top-level errors[] using
          // the SAME string as the ParseError.error field. AI recovery
          // (src/pipeline/scrape.ts:87) cleans up errors[] entries that
          // exact/prefix match a recovered ParseError.error, so per-row
          // pushes round-trip cleanly through the recovery path. A
          // slug-level summary message would not match any individual
          // ParseError.error and would linger in errors[] after recovery,
          // keeping the scrape FAILED and reconcile blocked even after the
          // dropped row was successfully restored.
          for (const pe of outcome.rowParseErrors) {
            errors.push(pe.error);
          }
        }
      }
    }

    // Step 3: Fetch detail pages in parallel batches
    for (let i = 0; i < matchingEntries.length; i += BATCH_SIZE) {
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
      const batch = matchingEntries.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map((entry) => fetchAndParseDetail(entry, errors, errorDetails)),
      );
      for (const result of results) {
        detailPagesFetched++;
        if (result.status === "fulfilled") {
          events.push(...result.value);
        } else {
          detailPagesFailed++;
        }
      }
    }

    const hasErrorDetails = hasAnyErrors(errorDetails);

    // Compute unmapped kennel slugs: slugs in the index that weren't in our configured set
    const allIndexSlugs = [...globalIndexSlugs];
    const unmappedKennelSlugs = allIndexSlugs.filter((s) => !kennelSlugs.has(s));

    // Approximate fallback count from detail page errors (each error triggers createFromIndex)
    // Exclude kennel page fetch errors since those don't produce createFromIndex fallbacks
    const indexOnlyFallbacks = Math.max(0, (errorDetails.fetch?.length ?? 0) - kennelPageFetchErrors) + (errorDetails.parse?.length ?? 0);

    return {
      events,
      errors,
      structureHash,
      errorDetails: hasErrorDetails ? errorDetails : undefined,
      diagnosticContext: {
        totalIndexEntries: allEntries.length,
        matchingEntries: matchingEntries.length,
        kennelSlugsConfigured: slugList,
        eventsProduced: events.length,
        fetchDurationMs: Date.now() - fetchStart,
        detailPagesFetched,
        detailPagesFailed,
        indexOnlyFallbacks,
        uniqueKennelSlugsInIndex: allIndexSlugs,
        unmappedKennelSlugs,
        kennelPagesChecked,
        kennelPageEventsFound,
        kennelPageFetchErrors,
        kennelPagesSkipped: Math.max(0, missingSlugs.length - kennelPagesChecked.length),
        kennelPagesStopReason,
      },
    };
  }
}

/**
 * Fetch and parse a single event's detail page.
 * Returns events on success, fallback events from index data on failure.
 */
async function fetchAndParseDetail(
  entry: IndexEntry,
  errors: string[],
  errorDetails: ErrorDetails,
): Promise<RawEventData[]> {
  try {
    const detailUrl = eventDetailUrl(entry.slug);
    const detailRes = await safeFetch(detailUrl, {
      headers: { "User-Agent": USER_AGENT },
    });

    if (!detailRes.ok) {
      errors.push(`Detail fetch failed for ${entry.slug}: HTTP ${detailRes.status}`);
      (errorDetails.fetch ??= []).push(
        { url: detailUrl, status: detailRes.status, message: `HTTP ${detailRes.status}` },
      );
      return createFromIndex(entry);
    }

    const detailHtml = await detailRes.text();
    const parsed = parseEventDetail(detailHtml, entry.slug, entry);
    return splitToRawEvents(parsed, entry.slug);
  } catch (err) {
    // Use the same string in both errors[] and ParseError.error so AI
    // recovery (scrape.ts:87) can match-and-clean the errors[] entry on
    // successful recovery. partialData.kennelTag/sourceUrl give the
    // recovered event a stable reconcile key — without sourceUrl, reconcile
    // would fail to match the existing canonical event and cancel it.
    const msg = `Error processing ${entry.slug}: ${err}`;
    errors.push(msg);
    errorDetails.parse ??= [];
    errorDetails.parse.push({
      row: 0,
      section: entry.slug,
      error: msg,
      rawText: `Slug: ${entry.slug}\nTitle: ${entry.title ?? "unknown"}\nDate: ${entry.startDate ?? "unknown"}`.slice(0, 2000),
      partialData: {
        kennelTag: entry.kennelSlug,
        sourceUrl: eventDetailUrl(entry.slug),
      },
    });
    return createFromIndex(entry);
  }
}

/**
 * Convert a JSON kennel-events API row into the legacy IndexEntry shape so
 * downstream helpers (parseHashRegoDate, parseHashRegoTime, createFromIndex)
 * work unchanged. CRITICAL: startDate must be "MM/DD/YY" and startTime must
 * be "h:mm AM/PM" — the legacy wire format — or the consumers drop the row.
 *
 * Throws HashRegoApiError("parse") on any missing/unparseable required field.
 * Never returns null and never invents a date.
 */
/** Convert a 24-hour hour to its 12-hour clock counterpart. */
function to12Hour(hour24: number): number {
  if (hour24 === 0) return 12;
  if (hour24 > 12) return hour24 - 12;
  return hour24;
}

export function apiToIndexEntry(api: HashRegoKennelEvent, kennelSlug: string): IndexEntry {
  if (!api?.slug || !api?.event_name || !api?.start_time) {
    throw new HashRegoApiError(
      kennelSlug,
      0,
      "parse",
      `missing required field on row ${api?.slug ?? "<no slug>"}`,
    );
  }

  // Split the ISO string rather than using `new Date()` to avoid local-TZ
  // drift — the API already encodes the intended wall-clock time.
  const match = HASHREGO_ISO_DATETIME_RE.exec(api.start_time);
  if (match === null) {
    throw new HashRegoApiError(
      kennelSlug,
      0,
      "parse",
      `unparseable start_time "${api.start_time}" on row ${api.slug}`,
    );
  }

  const [, yyyy, mm, dd, hh, min] = match;
  const year2 = yyyy.slice(-2);
  const hourNum = Number.parseInt(hh, 10);
  const minNum = Number.parseInt(min, 10);
  const ampm = hourNum >= 12 ? "PM" : "AM";
  const hour12 = to12Hour(hourNum);
  const timeStr = `${hour12}:${String(minNum).padStart(2, "0")} ${ampm}`;

  return {
    slug: api.slug,
    // Query slug is authoritative — avoids API casing inconsistencies.
    kennelSlug,
    title: api.event_name,
    startDate: `${mm}/${dd}/${year2}`,
    startTime: timeStr,
    type: "",
    cost: api.current_price != null ? `$${api.current_price}` : "",
  };
}

/**
 * Non-PII field whitelist for error diagnostics. See seletar-h3.ts safeRowSample
 * for the equivalent pattern on the other adapter that handles user-supplied data.
 */
function safeApiRowSample(row: Partial<HashRegoKennelEvent>): string {
  return JSON.stringify({
    slug: row.slug,
    host_kennel_slug: row.host_kennel_slug,
    start_time: row.start_time,
    current_price: row.current_price,
    is_over: row.is_over,
  });
}

/**
 * Step 2b call outcome. `ok` carries the converted IndexEntries and any
 * row-level parse failures (partial success). `fail` carries a single
 * whole-call error (transport, auth, rate-limit, server, or whole-response
 * parse drift).
 */
type Step2bOutcome =
  | { kind: "ok"; entries: IndexEntry[]; rowParseErrors: ParseError[] }
  | { kind: "fail"; error: HashRegoApiError };

/**
 * Fetch a kennel's events from the JSON API and convert each row into an
 * IndexEntry. Network/HTTP failures return a `fail` outcome (the whole
 * kennel call is dropped). Row-level parse failures are accumulated into
 * `rowParseErrors` so a single bad row doesn't lose the other events from
 * the same kennel.
 */
async function fetchAndConvertKennelEvents(
  slug: string,
  timeoutMs: number,
): Promise<Step2bOutcome> {
  let rows: HashRegoKennelEvent[];
  try {
    rows = await fetchKennelEvents(slug, { timeoutMs });
  } catch (err) {
    return {
      kind: "fail",
      error:
        err instanceof HashRegoApiError
          ? err
          : new HashRegoApiError(slug, 0, "network", String(err)),
    };
  }

  const entries: IndexEntry[] = [];
  const rowParseErrors: ParseError[] = [];
  rows.forEach((row, index) => {
    try {
      entries.push(apiToIndexEntry(row, slug));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Build a deterministic sourceUrl from the row's slug if we have it.
      // CRITICAL: reconcile.ts keys on (kennelId, date, sourceUrl). If AI
      // recovery emits an event with an empty sourceUrl, the recovered
      // event won't match the existing canonical Hash Rego event → false
      // CANCELLED on the next reconcile pass.
      const rowSlug = typeof row?.slug === "string" ? row.slug : undefined;
      const sourceUrl = rowSlug ? eventDetailUrl(rowSlug) : undefined;
      rowParseErrors.push({
        row: index,
        section: slug,
        error: message,
        rawText: safeApiRowSample(row ?? {}),
        partialData: { kennelTag: slug, sourceUrl },
      });
    }
  });

  return { kind: "ok", entries, rowParseErrors };
}

/**
 * Create a basic RawEventData from index data when detail page fetch fails.
 * Less rich, but ensures we still capture the event.
 */
function createFromIndex(entry: IndexEntry): RawEventData[] {
  const date = parseHashRegoDate(entry.startDate);
  if (!date) return [];

  const time = parseHashRegoTime(entry.startTime);
  const hashRegoUrl = eventDetailUrl(entry.slug);

  return [
    {
      date,
      kennelTag: entry.kennelSlug,
      title: entry.title,
      startTime: time || undefined,
      sourceUrl: hashRegoUrl,
      externalLinks: [{ url: hashRegoUrl, label: "Hash Rego" }],
    },
  ];
}
