/**
 * One-shot historical backfill for Lisbon H3 (lh3-pt).
 *
 * The live Harrier Central adapter (`harrier-central/adapter.ts`) reads HC's
 * `getEvents` API, which is FUTURE-ONLY — so past runs never reach canonical
 * Events through the normal scrape. (See memory
 * `reference_harrier_central_getevents_future_only`.) The full archive HC holds
 * is server-rendered on the hashruns.org public UI as JSON in the Next.js flight
 * data (`self.__next_f`).
 *
 * IMPORTANT COVERAGE NOTE: HC only holds LH3 from ~run #975 (Dec 2024) onward —
 * the kennel joined Harrier Central recently. `hashruns.org/LH3-PT/runs` exposes
 * runs #975→latest; per-run pages for older runs (e.g. /LH3-PT/500) 404. The
 * deep pre-HC archive (#1–#974, 1987→2024) is NOT in Harrier Central and is not
 * recoverable from this source — tracked as a follow-up to #2037. This script
 * therefore recovers ~40 genuinely-past runs (#975→just-before-today), which is
 * everything HC actually has, not the ~1000 the audit extrapolated from the run
 * number.
 *
 * The script fetches the SSR page LIVE (live-verification rule) and parses the
 * flight-data event objects. `reportAndApplyBackfill` partitions strictly on
 * `date < today (Europe/Lisbon)` so only past runs are written, and dedupes by
 * fingerprint on every re-run. Rows bind to the live "Lisbon H3 Harrier Central"
 * source (same data provider — provenance-correct; no separate archive source).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-lh3-pt-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lh3-pt-history.ts
 *
 * Requires the "Lisbon H3 Harrier Central" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { applyTitleFallback, composeHcLocation } from "@/adapters/harrier-central/adapter";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Lisbon H3 Harrier Central";
const KENNEL_TIMEZONE = "Europe/Lisbon";
const KENNEL_TAG = "lh3-pt";
const RUNS_URL = "https://www.hashruns.org/LH3-PT/runs";

// Mirror the live adapter's title synthesis so backfilled titles match what HC
// would have produced (placeholder slots → "Lisbon H3 #N"). Same shape as the
// seed config for this source.
const TITLE_CONFIG = {
  defaultTitle: "Lisbon H3",
  staleTitleAliases: ["Placeholder event for LH3"],
} as const;

/** Shape of an event object in the hashruns.org SSR flight data (PascalCase). */
interface SsrEvent {
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

/**
 * Parse the SSR flight data into event objects. The page embeds each run as a
 * flat JSON object (no nested braces — `tags` is an array, images are strings),
 * escaped as `\"` inside `self.__next_f.push([...])`. Unescape, then match each
 * `{…}` carrying an `"EventNumber"`, JSON.parse, and dedupe by PublicEventId
 * (events appear twice — card + schedule list).
 */
function parseSsrEvents(html: string): SsrEvent[] {
  const unescaped = html.replaceAll('\\"', '"');
  const matches = unescaped.match(/\{[^{}]*?"EventNumber":[^{}]*?\}/g) ?? [];
  const byId = new Map<string, SsrEvent>();
  for (const raw of matches) {
    let obj: SsrEvent;
    try {
      obj = JSON.parse(raw) as SsrEvent;
    } catch {
      continue; // partial/garbled fragment — skip
    }
    if (!obj.EventStartDatetime) continue;
    const key = obj.PublicEventId ?? `${obj.EventNumber}-${obj.EventStartDatetime}`;
    if (!byId.has(key)) byId.set(key, obj);
  }
  return [...byId.values()];
}

/** HC eventNumber tri-state (mirrors the read-only adapter's normalizeHcEventNumber). */
function normalizeRunNumber(n: number | undefined): number | null | undefined {
  if (n === 0) return null; // social / drinking practice
  if (typeof n === "number" && n > 0) return n;
  return undefined;
}

/** Trim + drop padded/case-variant "TBA" placeholders (mirrors adapter stripTba). */
function stripTba(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && !/^tba$/i.test(trimmed) ? trimmed : undefined;
}

function toRawEvent(e: SsrEvent): RawEventData {
  const date = e.EventStartDatetime!.slice(0, 10);
  const timeMatch = e.EventStartDatetime!.match(/T(\d{2}:\d{2})/);
  // composeHcLocation strips TBA + placeholder sentinels ("No location
  // provided", "TBD", …) internally, returning undefined for non-venues.
  const location = composeHcLocation(e.LocationOneLineDesc, undefined, undefined);
  // Drop HC's region-default fallback pin when there is no real venue, letting
  // the merge pipeline geocode from place text + country bias instead.
  const hasVenue = location !== undefined;
  return {
    date,
    kennelTags: [KENNEL_TAG],
    title: applyTitleFallback(e.EventName, e.EventNumber, TITLE_CONFIG),
    runNumber: normalizeRunNumber(e.EventNumber),
    startTime: timeMatch ? timeMatch[1] : undefined,
    hares: stripTba(e.Hares),
    location,
    locationStreet: stripTba(e.LocationStreet),
    latitude: hasVenue && typeof e.Latitude === "number" ? e.Latitude : undefined,
    longitude: hasVenue && typeof e.Longitude === "number" ? e.Longitude : undefined,
  };
}

async function fetchEvents(): Promise<RawEventData[]> {
  const res = await fetch(RUNS_URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`hashruns.org returned HTTP ${res.status} for ${RUNS_URL}`);
  }
  const html = await res.text();
  const ssr = parseSsrEvents(html);
  if (ssr.length === 0) {
    throw new Error(
      `Parsed 0 events from ${RUNS_URL} — the SSR flight-data shape may have changed.`,
    );
  }
  console.log(`  Parsed ${ssr.length} SSR events (run #${Math.min(...ssr.map((s) => s.EventNumber ?? 0))}–${Math.max(...ssr.map((s) => s.EventNumber ?? 0))})`);
  return ssr.map(toRawEvent);
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Fetching + parsing hashruns.org/LH3-PT SSR archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
