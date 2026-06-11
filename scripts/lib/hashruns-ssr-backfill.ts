/**
 * Shared machinery for one-shot historical backfills that recover a Harrier
 * Central kennel's full archive from the hashruns.org public UI.
 *
 * The live HC adapter (`harrier-central/adapter.ts`) reads HC's `getEvents` API,
 * which is FUTURE-ONLY (see memory `reference_harrier_central_getevents_future_only`),
 * so past runs never reach canonical Events through the normal scrape. The full
 * archive HC holds is server-rendered on hashruns.org as JSON in the Next.js
 * flight data (`self.__next_f`). This module fetches that page LIVE, parses the
 * flight-data event objects, and routes the genuinely-past slice through the
 * live merge pipeline via `runBackfillScript` (strict `date < today` partition,
 * fingerprint-deduped, idempotent on re-run).
 *
 * Extracted from the original Lisbon backfill (#2048) so a second kennel
 * (Porto Invicta, #2119) reuses it instead of copy-pasting ~120 lines.
 */
import { runBackfillScript } from "./backfill-runner";
import {
  applyTitleFallback,
  composeHcLocation,
  type HarrierCentralConfig,
} from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

/** Shape of an event object in the hashruns.org SSR flight data (PascalCase). */
export interface SsrEvent {
  PublicEventId?: string;
  EventNumber?: number;
  EventName?: string;
  EventStartDatetime?: string; // "2026-05-30T13:00:00" (kennel-local wall time)
  Hares?: string;
  LocationOneLineDesc?: string;
  LocationStreet?: string;
  Latitude?: number;
  Longitude?: number;
}

/** An SSR event known to carry a start datetime (the only required field). */
export type DatedSsrEvent = SsrEvent & { EventStartDatetime: string };

export interface HashrunsSsrBackfillConfig {
  /** hashruns.org kennel slug, e.g. "PIH3" → https://www.hashruns.org/PIH3/runs */
  slug: string;
  /** Single kennel tag every recovered row binds to. */
  kennelTag: string;
  /** IANA timezone used to partition past vs future (e.g. "Europe/Lisbon"). */
  kennelTimezone: string;
  /** Exact DB Source.name to merge rows under (must already be seeded + linked). */
  sourceName: string;
  /**
   * Title fallback config — mirror the live source's seed config (only
   * `defaultTitle` + `staleTitleAliases` are read by `applyTitleFallback`).
   */
  titleConfig: HarrierCentralConfig;
}

/**
 * Parse the SSR flight data into event objects. The page embeds each run as a
 * flat JSON object (no nested braces — `tags` is an array, images are strings),
 * escaped as `\"` inside `self.__next_f.push([...])`. Unescape, then match each
 * `{…}` carrying an `"EventNumber"`, JSON.parse, and dedupe by PublicEventId
 * (events appear twice — card + schedule list). The `[^{}]*` class is brace-
 * free, so the match is bounded to a single flat object and is ReDoS-safe.
 */
export function parseSsrEvents(pageText: string): DatedSsrEvent[] {
  const unescaped = pageText.replaceAll(String.raw`\"`, '"');
  const matches = unescaped.match(/\{[^{}]*"EventNumber":[^{}]*\}/g) ?? [];
  const byId = new Map<string, DatedSsrEvent>();
  for (const raw of matches) {
    let obj: SsrEvent;
    try {
      obj = JSON.parse(raw) as SsrEvent;
    } catch {
      continue; // partial/garbled fragment — skip
    }
    if (!obj.EventStartDatetime) continue;
    const dated = obj as DatedSsrEvent;
    const key = dated.PublicEventId ?? `${dated.EventNumber}-${dated.EventStartDatetime}`;
    if (!byId.has(key)) byId.set(key, dated);
  }
  return [...byId.values()];
}

/** HC eventNumber tri-state (mirrors the read-only adapter's normalizeHcEventNumber). */
export function normalizeRunNumber(n: number | undefined): number | null | undefined {
  if (n === 0) return null; // social / drinking practice
  if (typeof n === "number" && n > 0) return n;
  return undefined;
}

/** Trim + drop padded/case-variant "TBA" placeholders (mirrors adapter stripTba). */
export function stripTba(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && !/^tba$/i.test(trimmed) ? trimmed : undefined;
}

function toRawEvent(e: DatedSsrEvent, config: HashrunsSsrBackfillConfig): RawEventData {
  const date = e.EventStartDatetime.slice(0, 10);
  const timeMatch = /T(\d{2}:\d{2})/.exec(e.EventStartDatetime);
  // composeHcLocation strips TBA + placeholder sentinels ("No location
  // provided", "TBD", …) internally, returning undefined for non-venues — apply
  // it to BOTH the venue and the street so an HC placeholder never persists as a
  // fake street fallback (merge/display treat locationStreet as a real address).
  const location = composeHcLocation(e.LocationOneLineDesc, undefined);
  const locationStreet = composeHcLocation(e.LocationStreet, undefined);
  // Drop HC's region-default fallback pin when there is no real venue, letting
  // the merge pipeline geocode from place text + country bias instead.
  const hasVenue = location !== undefined;
  return {
    date,
    kennelTags: [config.kennelTag],
    title: applyTitleFallback(e.EventName, e.EventNumber, config.titleConfig),
    runNumber: normalizeRunNumber(e.EventNumber),
    startTime: timeMatch ? timeMatch[1] : undefined,
    hares: stripTba(e.Hares),
    location,
    locationStreet,
    latitude: hasVenue && typeof e.Latitude === "number" ? e.Latitude : undefined,
    longitude: hasVenue && typeof e.Longitude === "number" ? e.Longitude : undefined,
  };
}

/** Map parsed SSR events to RawEventData rows for a given kennel config. */
export function ssrEventsToRawEvents(
  events: DatedSsrEvent[],
  config: HashrunsSsrBackfillConfig,
): RawEventData[] {
  return events.map((e) => toRawEvent(e, config));
}

/**
 * One-call entry point for a hashruns.org SSR backfill script: fetch the runs
 * page live, parse + map, then partition/apply via `runBackfillScript`. Honors
 * BACKFILL_APPLY=1 (apply) vs dry-run, exactly like the other backfill wrappers.
 */
export function hashrunsSsrBackfill(config: HashrunsSsrBackfillConfig): Promise<void> {
  const runsUrl = `https://www.hashruns.org/${config.slug}/runs`;
  return runBackfillScript({
    sourceName: config.sourceName,
    kennelTimezone: config.kennelTimezone,
    label: `Fetching + parsing hashruns.org/${config.slug} SSR archive`,
    fetchEvents: async () => {
      const res = await fetch(runsUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
          Accept: "text/html",
        },
      });
      if (!res.ok) {
        throw new Error(`hashruns.org returned HTTP ${res.status} for ${runsUrl}`);
      }
      const body = await res.text();
      const ssr = parseSsrEvents(body);
      if (ssr.length === 0) {
        throw new Error(
          `Parsed 0 events from ${runsUrl} — the SSR flight-data shape may have changed.`,
        );
      }
      const nums = ssr.map((s) => s.EventNumber ?? 0);
      console.log(`  Parsed ${ssr.length} SSR events (run #${Math.min(...nums)}–${Math.max(...nums)})`);
      return ssrEventsToRawEvents(ssr, config);
    },
  });
}
