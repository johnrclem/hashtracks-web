import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult, ErrorDetails } from "../types";
import { hasAnyErrors } from "../types";
import { safeFetch } from "../safe-fetch";
import { filterEventsByWindow, validateSourceConfig } from "../utils";
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

/**
 * Env var holding the publishable `anon` JWT (`role:anon`, RLS-gated — same class
 * as a NEXT_PUBLIC_* key). Kept out of committed code (no secret-shaped literal in
 * git) and read by both the adapter and the history backfill, so a key rotation is
 * a one-place change. Re-extract from the live `/assets/*.js` bundle if it rotates.
 */
export const RIYADH_ANON_ENV = "RIYADH_H3_SUPABASE_ANON_KEY";

/** Resolve the anon key: explicit source-config override → env var. */
export function resolveRiyadhAnonKey(configKey?: string): string | undefined {
  return configKey ?? process.env[RIYADH_ANON_ENV];
}

const KENNEL_TAG = "riyadh-h3";

/** Today's date ("YYYY-MM-DD") in the kennel's local zone (Asia/Riyadh, UTC+3).
 *  Used as the forward/past split boundary so a row is classified by the kennel's
 *  calendar day, not UTC — avoids misfiling around midnight Riyadh time. Shared
 *  with the history backfill so both sides split on the same instant. */
export function riyadhToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}

/** Columns consumed by mapHikeRow — explicit `select` so the wire payload never
 *  carries unused (or future large) columns. Shared with the history backfill. */
export const HIKES_SELECT =
  "run_number,date,title,location,gathering_time,location_gps,map_link,description";

export interface RiyadhH3Config {
  /** Supabase project ref, e.g. "uleyjftvdnpniabomdpi" → <ref>.supabase.co */
  supabaseProjectRef: string;
  /** PostgREST table name, e.g. "hikes" */
  supabaseTable: string;
  /** Publishable role:anon JWT override. Falls back to the RIYADH_ANON_ENV env var. */
  supabaseAnonKey?: string;
  // NOTE: `upcomingOnly` lives in source.config but is read by reconcile.ts, not
  // this adapter, so it is intentionally not declared here.
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
  // Present in the API but intentionally not mapped (no RawEventData analog):
  difficulty?: string | null; // free-text hike rating ("moderate") — NOT the 1–5 Shiggy scale
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
    const errors: string[] = [];
    const errorDetails: ErrorDetails = {};
    const fetchStart = Date.now();

    const base = `https://${config.supabaseProjectRef}.supabase.co/rest/v1/${config.supabaseTable}`;

    const anonKey = resolveRiyadhAnonKey(config.supabaseAnonKey);
    if (!anonKey) {
      const msg = `Riyadh H3: missing anon key — set the ${RIYADH_ANON_ENV} env var (or config.supabaseAnonKey)`;
      errorDetails.fetch = [{ url: base, message: msg }];
      return { events: [], errors: [msg], errorDetails };
    }

    // Forward window only: the backfill owns `date < today`. Boundary is the
    // kennel's local day (Asia/Riyadh); today's event (gte) is included by the
    // adapter and excluded by the strictly-less-than backfill, so there is no gap.
    const today = riyadhToday();
    const url = `${base}?select=${HIKES_SELECT}&order=date.desc&deleted_at=is.null&date=gte.${today}`;

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
      },
    };
  }
}
