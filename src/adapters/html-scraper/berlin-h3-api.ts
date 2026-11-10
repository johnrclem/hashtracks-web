/**
 * Berlin H3 + Berlin Full Moon H3 — the wordpress-hash-event-api JSON feed.
 *
 * berlin-h3.eu runs bb-Ricardo/wordpress-hash-event-api, a small service that
 * serves the site's WP Event Manager posts as Hash runs. It exposes two views:
 *
 *   - `/events.ics` (the old ICAL_FEED source). Its calendar route always sets
 *     `last_update__gt = now - N weeks`, so a run drops out of the feed once its
 *     post hasn't been *edited* for N weeks, however far ahead it is. On
 *     2026-10-26 the kennel bulk-created runs #2362–#2370 and Full Moons
 *     #156–#157; on ~11-09 all eleven aged out together and reconcile tried to
 *     cancel them (EXCESSIVE_CANCELLATIONS).
 *   - `/api/v1/runs/all` (this adapter). The same records as JSON, with no
 *     edit-date filter: every run since the 2021 relaunch (343 at onboarding),
 *     with kennel name, run number, hares, venue, map pin and hash cash.
 *
 * `deleted` (unpublished, or `_cancelled` set) and `event_hidden` rows are
 * dropped, so reconcile cancels them like the ICS did. "Drinking Practice"
 * posts are socials, not trails, and are dropped too.
 */

import type { Source } from "@/generated/prisma/client";
import type { SourceAdapter, RawEventData, ScrapeResult } from "../types";
import { extractHashRunNumber, filterEventsByWindow, stripHtmlTags } from "../utils";
import { safeFetch } from "../safe-fetch";

const DEFAULT_URL = "https://www.berlin-h3.eu/api/v1/runs/all";
const DEFAULT_DAYS = 365;

/** `kennel_name` → kennelCode. An unknown name fails loud (see fetch). */
const KENNEL_BY_NAME: Record<string, string> = {
  "Berlin H3": "berlinh3",
  "Berlin Full Moon H3": "bh3fm",
};

const SKIPPED_EVENT_TYPES = new Set(["Drinking Practice"]);

/** "details cuming", "Details are cuming ….", "Details below." — not a description. */
const PLACEHOLDER_DESCRIPTION_RE = /^details\b[^\n]{0,30}$/i;

/** Local wall-clock parts of an offset ISO timestamp ("2026-11-15T13:45:00+01:00"). */
const LOCAL_ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

export interface BerlinApiRun {
  id: number;
  event_name: string;
  kennel_name: string | null;
  event_description: string | null;
  event_type: string;
  start_date: string;
  end_date: string | null;
  deleted: boolean;
  event_hidden: boolean;
  run_number: number | null;
  hares: string | null;
  geo_lat: number | null;
  geo_long: number | null;
  geo_location_name: string | null;
  geo_map_url: string | null;
  location_name: string | null;
  location_additional_info: string | null;
  event_url: string | null;
  hash_cash_members: number | null;
  hash_cash_non_members: number | null;
  event_currency: string | null;
}

function splitLocalIso(iso: string | null): { date: string; time: string } | null {
  const m = iso ? LOCAL_ISO_RE.exec(iso) : null;
  return m ? { date: m[1], time: `${m[2]}:${m[3]}` } : null;
}

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/** "5€"; "4€ members / 5€ non-members" when the prices differ. */
export function formatHashCash(run: Pick<BerlinApiRun, "hash_cash_members" | "hash_cash_non_members" | "event_currency">): string | undefined {
  const currency = run.event_currency ?? "€";
  const members = run.hash_cash_members;
  const others = run.hash_cash_non_members ?? members;
  if (members == null) return others == null ? undefined : `${others}${currency}`;
  if (others == null || others === members) return `${members}${currency}`;
  return `${members}${currency} members / ${others}${currency} non-members`;
}

function buildDescription(run: BerlinApiRun): string | undefined {
  // Gutenberg block comments leave runs of blank lines behind.
  const body = run.event_description
    ? stripHtmlTags(run.event_description, "\n").replaceAll(/\n{3,}/g, "\n\n")
    : "";
  const text = PLACEHOLDER_DESCRIPTION_RE.test(body) ? "" : body;
  const meet = nonEmpty(run.location_additional_info);
  const parts = [text, meet ? `Meeting point: ${meet}` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export type BerlinRunOutcome =
  | { event: RawEventData }
  | { skipped: "deleted" | "hidden" | "event-type" }
  | { error: string };

/** Map one API row to a RawEvent. Exported for tests. */
export function parseBerlinRun(run: BerlinApiRun): BerlinRunOutcome {
  if (run.deleted) return { skipped: "deleted" };
  if (run.event_hidden) return { skipped: "hidden" };
  if (SKIPPED_EVENT_TYPES.has(run.event_type)) return { skipped: "event-type" };

  const kennelTag = run.kennel_name ? KENNEL_BY_NAME[run.kennel_name] : undefined;
  if (!kennelTag) return { error: `run ${run.id}: unknown kennel_name "${run.kennel_name ?? ""}"` };

  const start = splitLocalIso(run.start_date);
  if (!start) return { error: `run ${run.id}: unparseable start_date "${run.start_date}"` };
  const end = splitLocalIso(run.end_date);

  const location = nonEmpty(run.location_name);
  const street = nonEmpty(run.geo_location_name);
  const coords =
    run.geo_lat != null && run.geo_long != null ? { latitude: run.geo_lat, longitude: run.geo_long } : {};

  return {
    event: {
      date: start.date,
      kennelTags: [kennelTag],
      // The API's run_number is free-form and drifts from the title: special
      // events carry the year ("BH3 Halloween Run 2024" → 2024) and "Run #2320"
      // carries 2317. The title's "#N" is the number the kennel announced.
      runNumber: extractHashRunNumber(run.event_name),
      title: nonEmpty(run.event_name),
      description: buildDescription(run),
      hares: nonEmpty(run.hares),
      location: location ?? street,
      locationStreet: location && street && street !== location ? street : undefined,
      locationUrl: nonEmpty(run.geo_map_url),
      ...coords,
      startTime: start.time,
      endTime: end && end.date === start.date ? end.time : undefined,
      endDate: end && end.date > start.date ? end.date : undefined,
      cost: formatHashCash(run),
      sourceUrl: nonEmpty(run.event_url),
    },
  };
}

function isRunArray(body: unknown): body is BerlinApiRun[] {
  return (
    Array.isArray(body) &&
    body.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as BerlinApiRun).id === "number" &&
        typeof (r as BerlinApiRun).event_name === "string" &&
        typeof (r as BerlinApiRun).start_date === "string",
    )
  );
}

export class BerlinH3ApiAdapter implements SourceAdapter {
  type = "HTML_SCRAPER" as const;

  async fetch(source: Source, options?: { days?: number }): Promise<ScrapeResult> {
    const url = source.url || DEFAULT_URL;
    const fetchStart = Date.now();
    let runs: BerlinApiRun[];
    try {
      const res = await safeFetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Scraper)", Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body: unknown = await res.json();
      // An HTML error page or an empty list must not read as "every run was
      // removed": reconcile would cancel the whole kennel.
      if (!isRunArray(body) || body.length === 0) throw new Error("unexpected payload (not a non-empty run array)");
      runs = body;
    } catch (err) {
      const message = `Berlin H3 API: fetch failed: ${err instanceof Error ? err.message : String(err)}`;
      return { events: [], errors: [message], errorDetails: { fetch: [{ url, message }] } };
    }

    const parsed: RawEventData[] = [];
    const errors: string[] = [];
    const skipped: Record<string, number> = {};
    for (const run of runs) {
      const outcome = parseBerlinRun(run);
      if ("event" in outcome) parsed.push(outcome.event);
      else if ("skipped" in outcome) skipped[outcome.skipped] = (skipped[outcome.skipped] ?? 0) + 1;
      else errors.push(`Berlin H3 API: ${outcome.error}`);
    }
    const events = filterEventsByWindow(parsed, options?.days ?? DEFAULT_DAYS);

    return {
      events,
      errors,
      diagnosticContext: {
        runsFetched: runs.length,
        eventsParsed: parsed.length,
        eventsInWindow: events.length,
        skipped,
        fetchDurationMs: Date.now() - fetchStart,
      },
    };
  }
}
