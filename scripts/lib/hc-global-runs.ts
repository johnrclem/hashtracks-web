/**
 * Shared Harrier Central historical-backfill helper.
 *
 * HC's azure `getEvents` API (what the live HarrierCentralAdapter uses) is
 * FUTURE-ONLY — it never returns past runs, so a kennel's back-catalogue can't
 * reach canonical Events from the recurring scrape. The hashruns.org front-end,
 * however, exposes a global past-runs feed that DOES carry history:
 *
 *   GET https://hashruns.org/api/global-runs
 *       ?isFuture=0&minEventDate=YYYY-MM-DD&maxEventDate=YYYY-MM-DD
 *     → { totalMatchingEvents, runs: [ {PublicKennelId, EventNumber, EventName,
 *         EventStartDatetime, Hares, LocationOneLineDesc, Latitude, Longitude,
 *         EventDescription, ...}, ... ] }
 *
 * Quirks (discovered live, #2306/#2404/#2411):
 *  - The feed is GLOBAL; its kennel query param is ignored — filter client-side
 *    by `PublicKennelId`.
 *  - `minEventDate`/`maxEventDate` must be bare `YYYY-MM-DD`; `isFuture` is "0"/"1".
 *  - A too-wide window 500s (server-side timeout). `sweepGlobalRuns` windows the
 *    range and halves any window that 500s, so the caller just passes a span.
 *  - HC adoption is RECENT per kennel (Tokyo ~2021-09, Taiwan ~2021-12); there is
 *    NO data before a kennel migrated to HC, regardless of its founding year. The
 *    recoverable depth is whatever the feed actually holds — caller reports the
 *    true count, never the founding-year estimate.
 *
 * Rows are mapped to the SAME `RawEventData` shape the live adapter emits (via
 * the adapter's exported `applyTitleFallback` + `composeHcLocation`) so the merge
 * pipeline dedupes recent runs against existing canonical Events instead of
 * duplicating them.
 */

import { safeFetch } from "@/adapters/safe-fetch";
import {
  applyTitleFallback,
  composeHcLocation,
  type HarrierCentralConfig,
} from "@/adapters/harrier-central/adapter";
import { eqTrimLc } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";
import { runBackfillScript } from "./backfill-runner";

const GLOBAL_RUNS_URL = "https://hashruns.org/api/global-runs";

/** Subset of global-runs fields this backfill consumes. */
export interface GlobalRun {
  PublicEventId: string;
  PublicKennelId: string;
  EventNumber?: number;
  EventName?: string;
  EventStartDatetime?: string; // "2026-06-28T19:00:00" (local, no offset)
  Hares?: string;
  LocationOneLineDesc?: string;
  Latitude?: number;
  Longitude?: number;
  EventDescription?: string;
}

interface GlobalRunsResponse {
  totalMatchingEvents?: number;
  runs?: GlobalRun[];
}

const DAY_MS = 86_400_000;
const DEFAULT_WINDOW_DAYS = 56;
const MIN_WINDOW_DAYS = 4; // floor for the halving retry

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function fetchWindow(minDate: string, maxDate: string): Promise<GlobalRun[] | null> {
  const url = `${GLOBAL_RUNS_URL}?isFuture=0&minEventDate=${minDate}&maxEventDate=${maxDate}`;
  const res = await safeFetch(url, { headers: { Referer: "https://hashruns.org/" } });
  if (res.status === 500) return null; // window too wide → caller halves
  if (!res.ok) throw new Error(`global-runs ${minDate}..${maxDate} → HTTP ${res.status}`);
  const json = (await res.json()) as GlobalRunsResponse;
  const runs = json.runs;
  if (!Array.isArray(runs)) {
    throw new TypeError(`global-runs ${minDate}..${maxDate}: unexpected shape (no runs[])`);
  }
  // A capped response (server returned fewer than it claims to match) would
  // silently drop history — treat it like a too-wide window so the caller halves
  // and retries instead of accepting a truncated page as complete.
  if (typeof json.totalMatchingEvents === "number" && json.totalMatchingEvents > runs.length) {
    return null;
  }
  return runs;
}

/** Recursively fetch [startMs, endMs], halving any sub-window that 500s. */
async function sweepRange(startMs: number, endMs: number, acc: Map<string, GlobalRun>): Promise<void> {
  let cursor = startMs;
  while (cursor <= endMs) {
    const windowEnd = Math.min(cursor + DEFAULT_WINDOW_DAYS * DAY_MS, endMs);
    await fetchOrSplit(cursor, windowEnd, acc);
    cursor = windowEnd + DAY_MS;
  }
}

async function fetchOrSplit(aMs: number, bMs: number, acc: Map<string, GlobalRun>): Promise<void> {
  const runs = await fetchWindow(isoDate(aMs), isoDate(bMs));
  if (runs) {
    for (const r of runs) {
      if (r.PublicEventId) acc.set(r.PublicEventId, r);
    }
    return;
  }
  // 500 → window too wide. Halve and retry, down to MIN_WINDOW_DAYS.
  const spanDays = Math.round((bMs - aMs) / DAY_MS);
  if (spanDays <= MIN_WINDOW_DAYS) {
    throw new Error(`global-runs still 500s at minimum window ${isoDate(aMs)}..${isoDate(bMs)}`);
  }
  const midMs = aMs + Math.floor((bMs - aMs) / 2);
  await fetchOrSplit(aMs, midMs, acc);
  await fetchOrSplit(midMs + DAY_MS, bMs, acc);
}

/**
 * Sweep the global past-runs feed across [startDate, endDate] (inclusive,
 * YYYY-MM-DD) and return every distinct run (deduped by PublicEventId), sorted
 * by date. Windows adaptively so a dense span never 500s the caller.
 */
export async function sweepGlobalRuns(startDate: string, endDate: string): Promise<GlobalRun[]> {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  const acc = new Map<string, GlobalRun>();
  await sweepRange(startMs, endMs, acc);
  return [...acc.values()].sort((a, b) =>
    (a.EventStartDatetime ?? "").localeCompare(b.EventStartDatetime ?? ""),
  );
}

const TIME_RE = /T(\d{2}:\d{2})/;
const TBA_RE = /^tba$/i;
const PLACEHOLDER_HARE_RE = /\bplaceholder (?:user|event)\b/i;

function clean(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}

/** EventNumber → runNumber tri-state, matching the live adapter (0 → null).
 * Uses Number.isInteger so a NaN/Infinity/float never reaches the integer column. */
function normalizeRunNumber(n: number | undefined): number | null | undefined {
  if (n === 0) return null;
  if (Number.isInteger(n) && (n as number) > 0) return n;
  return undefined;
}

/** Stale-title fallback — "<defaultTitle> #N" when configured, else undefined.
 * Mirrors `staleTitleFallback` in the live HC adapter. */
function staleTitleFallback(
  eventNumber: number | undefined,
  config: HarrierCentralConfig,
): string | undefined {
  if (config.defaultTitle && typeof eventNumber === "number" && eventNumber > 0) {
    return `${config.defaultTitle} #${eventNumber}`;
  }
  return undefined;
}

/**
 * Trim + drop TBA / placeholder / venue-equal hares. Clears to `undefined`
 * (NOT null) to match the live HC adapter, which uses undefined for exactly
 * these cases — so a backfilled row fingerprints identically to a live scrape.
 */
function cleanHares(raw: string | undefined, location: string | undefined): string | undefined {
  const t = clean(raw);
  if (!t || TBA_RE.test(t) || PLACEHOLDER_HARE_RE.test(t)) return undefined;
  if (eqTrimLc(t, location)) return undefined;
  return t;
}

/**
 * Map one global-runs row to a RawEventData for `kennelTag`, applying the live
 * adapter's title-fallback + location-compose conventions so backfilled rows
 * line up with the recurring scrape's output.
 */
export function mapRunToRawEvent(
  run: GlobalRun,
  kennelTag: string,
  config: HarrierCentralConfig,
): RawEventData | null {
  const start = run.EventStartDatetime;
  if (!start) return null;
  const date = start.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const startTime = TIME_RE.exec(start)?.[1];
  const location = composeHcLocation(run.LocationOneLineDesc, undefined, undefined);
  const hares = cleanHares(run.Hares, location);
  let title = applyTitleFallback(run.EventName, run.EventNumber, config);
  // #2408/#2409 parity: a title that byte-equals the hares or the raw venue is
  // never a real run title (the source pasted the neighborhood/hash name into
  // the title slot, e.g. "Nogizaka", "Cancelled") — re-route through the
  // stale-title fallback so it matches what the live adapter would store.
  if (
    title &&
    (eqTrimLc(title, run.Hares) ||
      eqTrimLc(title, run.LocationOneLineDesc) ||
      eqTrimLc(title, location))
  ) {
    title = staleTitleFallback(run.EventNumber, config);
  }
  // When HC has no real venue (placeholder dropped to undefined), its coords are
  // a region-default pin — drop them and let the merge geocoder resolve instead.
  const hasVenue = location !== undefined;

  return {
    date,
    kennelTags: [kennelTag],
    title,
    runNumber: normalizeRunNumber(run.EventNumber),
    startTime,
    hares,
    location,
    latitude: hasVenue && typeof run.Latitude === "number" ? run.Latitude : undefined,
    longitude: hasVenue && typeof run.Longitude === "number" ? run.Longitude : undefined,
    description: clean(run.EventDescription),
  };
}

export interface HcKennelBackfillOptions {
  /** Source row name (must exist + be linked to the kennel). */
  sourceName: string;
  /** Target kennelCode the runs are routed to. */
  kennelTag: string;
  /** HC PublicKennelId used to filter the global feed client-side. */
  publicKennelId: string;
  /** IANA timezone for the past/future partition. */
  kennelTimezone: string;
  /** Earliest date to sweep (YYYY-MM-DD); pre-HC-adoption windows return nothing. */
  historyStart: string;
  /** Source config (defaultTitle + staleTitleAliases) for adapter-faithful titles. */
  config: HarrierCentralConfig;
  /** `[1/2]` header label. */
  label: string;
}

/**
 * One-call HC kennel backfill: sweep the global-runs feed from `historyStart` to
 * today, keep this kennel's runs, map them to the live adapter's shape, and route
 * the past slice through the merge pipeline. Shared by every HARRIER_CENTRAL
 * backfill wrapper so the per-kennel scripts are pure config (no duplicated
 * fetch/filter/map/run boilerplate). Logs + exits non-zero on failure.
 */
export function runHcKennelBackfill(opts: HcKennelBackfillOptions): void {
  runBackfillScript({
    sourceName: opts.sourceName,
    kennelTimezone: opts.kennelTimezone,
    label: opts.label,
    fetchEvents: async () => {
      // UTC `today` is the sweep endpoint only — reportAndApplyBackfill
      // re-partitions with todayInTimezone(kennelTimezone), so a ≤1-day-wide
      // sweep here is harmless.
      const today = new Date().toISOString().slice(0, 10);
      const runs = await sweepGlobalRuns(opts.historyStart, today);
      return runs
        .filter((r) => r.PublicKennelId === opts.publicKennelId)
        .map((r) => mapRunToRawEvent(r, opts.kennelTag, opts.config))
        .filter((e): e is RawEventData => e !== null);
    },
  }).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
