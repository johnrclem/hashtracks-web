import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { buildDateWindow, filterEventsByWindow, validateSourceConfig } from "../utils";
import { parseDMSFromLocation } from "@/lib/geo";

/**
 * Riyadh H3 / R3H4 adapter — first Saudi Arabia kennel.
 *
 * riyadhhash.com is a Lovable.dev React/Vite SPA (empty HTML shell), so the
 * rendered DOM cannot be scraped. Run data is served as clean JSON from the
 * site's public Supabase / PostgREST `anon` API (project ref
 * `uleyjftvdnpniabomdpi`, table `hikes`). This is a config-driven JSON client
 * (closer in shape to the Meetup / Harrier Central adapters than a Cheerio
 * scraper): a single authenticated GET + a column map. One query returns the
 * full set — no pagination.
 *
 * Forward/past split (ONH3 pattern): this adapter fetches only `date >= today`.
 * The `hikes` table also holds 2025+ history, which is loaded once by
 * `scripts/backfill-riyadh-h3-history.ts` (`date < today`). The seed source sets
 * `config.upcomingOnly: true` so `reconcile.ts` clamps its cancellation window
 * to the future and never false-cancels the backfilled past rows.
 *
 * The `anon` JWT is publishable (`"role":"anon"`, RLS-gated — same class as a
 * `NEXT_PUBLIC_*` key), so it is safe to keep here / in source config. It can
 * rotate; re-extract from the live `/assets/*.js` bundle if the API starts 401ing.
 */

/** Default publishable `anon` JWT (role:anon, RLS-gated). Overridable via config.
 *  Exported so the one-shot history backfill reuses the same key + column map. */
export const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsZXlqZnR2ZG5wbmlhYm9tZHBpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDgxODM3MTUsImV4cCI6MjA2Mzc1OTcxNX0.PnrMtWRot-kj7XXe4j3PZhcsGZJ4lbv3O7BXGJNUIj8";

const KENNEL_TAG = "riyadh-h3";

export interface RiyadhH3Config {
  /** Supabase project ref, e.g. "uleyjftvdnpniabomdpi" → <ref>.supabase.co */
  supabaseProjectRef: string;
  /** PostgREST table name, e.g. "hikes" */
  supabaseTable: string;
  /** Publishable role:anon JWT. Falls back to DEFAULT_ANON_KEY when omitted. */
  supabaseAnonKey?: string;
  upcomingOnly?: boolean;
}

/** Shape of a single row from the `hikes` PostgREST table (subset consumed). */
export interface HikeRow {
  id?: string;
  run_number?: string | null;
  date?: string | null; // "YYYY-MM-DD"
  title?: string | null;
  location?: string | null;
  gathering_time?: string | null; // "16:30:00"
  circle_time?: string | null; // circle START, NOT an event end — do not map to endTime
  location_gps?: string | null; // DMS, e.g. 24°43'17.4"N 46°24'46.2"E
  map_link?: string | null; // Google Maps shortlink
  description?: string | null;
  registration_status?: string | null;
  deleted_at?: string | null;
}

/** Convert a PostgREST time "16:30:00" → "16:30" ("HH:MM"); undefined otherwise. */
function toHhmm(time: string | null | undefined): string | undefined {
  if (!time) return undefined;
  const trimmed = time.trim();
  // Expect "HH:MM" or "HH:MM:SS" — keep the first five chars when well-formed.
  if (trimmed.length < 5 || trimmed[2] !== ":") return undefined;
  return trimmed.slice(0, 5);
}

/** Trim and collapse a free-text field to a value or undefined. */
function clean(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Map a single hike row to RawEventData. Exported for unit testing against
 * fixture rows (the live-verification rule still requires a real fetch).
 */
export function mapHikeRow(row: HikeRow): RawEventData | null {
  const date = clean(row.date);
  if (!date) return null; // date is required; a row without one is unusable

  const runNumberParsed = row.run_number
    ? Number.parseInt(row.run_number, 10)
    : Number.NaN;
  const runNumber = Number.isNaN(runNumberParsed) ? undefined : runNumberParsed;

  // location_gps carries real per-event DMS coordinates on ~half the rows.
  // Parse to lat/lng when present; otherwise leave undefined and let the merge
  // pipeline geocode from the location text / Riyadh centroid. No default-pin
  // trap (these are the actual GPS, not a kennel-wide fallback).
  const coords = row.location_gps ? parseDMSFromLocation(row.location_gps) : null;

  return {
    date,
    kennelTags: [KENNEL_TAG],
    // Titles are overwhelmingly real theme names ("Dead Camel Rage", "Dark
    // Night Hash"); only a handful are place-name dups of `location`. Keep the
    // title verbatim — far better than dropping 56/59 real themes — and let
    // merge synthesize "Riyadh H3 Trail #N" only when a row genuinely lacks one.
    title: clean(row.title),
    runNumber,
    startTime: toHhmm(row.gathering_time),
    location: clean(row.location),
    locationUrl: clean(row.map_link),
    description: clean(row.description),
    ...(coords ? { latitude: coords.lat, longitude: coords.lng } : {}),
    // No hares / cost / endTime in the feed. circle_time is the circle start,
    // not an event end, so it is intentionally not mapped to endTime.
  };
}

export class RiyadhH3Adapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const config = validateSourceConfig<RiyadhH3Config>(source.config, "RiyadhH3", {
      supabaseProjectRef: "string",
      supabaseTable: "string",
    });
    const anonKey = config.supabaseAnonKey ?? DEFAULT_ANON_KEY;
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    // Forward window only: the backfill owns `date < today`. Use UTC "today" as
    // the lower bound; today's event (gte) is included by the adapter and
    // excluded by the strictly-less-than backfill, so there is no gap.
    const today = new Date().toISOString().slice(0, 10);
    const base = `https://${config.supabaseProjectRef}.supabase.co/rest/v1/${config.supabaseTable}`;
    const url = `${base}?select=*&order=date.desc&deleted_at=is.null&date=gte.${today}`;

    let rows: HikeRow[];
    try {
      const res = await safeFetch(url, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });

      if (!res.ok) {
        const msg = `Riyadh H3 Supabase API returned HTTP ${res.status}`;
        errorDetails.fetch = [{ url, status: res.status, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }

      const json = (await res.json()) as unknown;
      // Runtime shape guard — never trust the cast. A 200 with a non-array body
      // (PostgREST error object, HTML error page) must NOT silently succeed, or
      // the reconciler would cancel live events against an empty result.
      if (!Array.isArray(json)) {
        const msg = "Riyadh H3 Supabase API: expected a JSON array of rows";
        errorDetails.fetch = [{ url, message: msg }];
        return { events: [], errors: [msg], errorDetails };
      }
      rows = json as HikeRow[];
    } catch (err) {
      const msg = `Riyadh H3 Supabase API fetch error: ${err}`;
      errorDetails.fetch = [{ url, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    const events: RawEventData[] = [];
    for (const row of rows) {
      const mapped = mapHikeRow(row);
      if (mapped) events.push(mapped);
    }

    // Honor options.days (forward cap; the lower bound is moot post date=gte).
    const days = options?.days ?? source.scrapeDays ?? 90;
    const { maxDate } = buildDateWindow(days);
    const filtered = filterEventsByWindow(events, days);

    // Single-surface source whose healthy baseline is small: a zero result
    // won't trip the zero-event health alert on its own. Push an explicit error
    // so reconcile is suppressed and the failure surfaces as an alert rather
    // than silently cancelling every upcoming Riyadh event.
    if (filtered.length === 0) {
      const msg = `Riyadh H3 Supabase API returned 0 upcoming rows (fetched ${rows.length}, window +${days}d)`;
      errors.push(msg);
      errorDetails.fetch = [...(errorDetails.fetch ?? []), { url, message: msg }];
    }

    return {
      events: filtered,
      errors,
      ...(hasAnyErrors(errorDetails) ? { errorDetails } : {}),
      diagnosticContext: {
        fetchDurationMs: Date.now() - fetchStart,
        rowsFetched: rows.length,
        eventsParsed: filtered.length,
        windowDays: days,
        windowMaxDate: maxDate.toISOString().slice(0, 10),
      },
    };
  }
}
