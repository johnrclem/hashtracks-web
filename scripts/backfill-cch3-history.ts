/**
 * One-shot historical backfill for Charm City H3 (Baltimore).
 *
 * Per issue #942, the CCH3 ai1ec iCal feed contains 95 events back to
 * 2023-05-12 (CCH3 Trail #253), but HashTracks has only 11. The recurring
 * ICAL_FEED adapter has a HARDCODED 90-day lookback at adapter.ts:487
 * (`const lookbackDays = 90`) — wider source.scrapeDays only widens the
 * forward window, not lookback. So this script does its own ICS fetch and
 * bypasses the date filter, building RawEvents using the adapter's exported
 * helpers (parseICalSummary, extractHaresFromDescription, etc.) so output
 * matches the recurring adapter's shape and fingerprints align.
 *
 * Output is deduped against existing RawEvents by fingerprint, so the
 * script is safely re-runnable. The next scheduled scrape's merge pipeline
 * promotes the new RawEvents to canonical Events.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-cch3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-cch3-history.ts
 */

import "dotenv/config";
import { sync as icalSync } from "node-ical";
import type { VEvent, DateWithTimeZone } from "node-ical";
import {
  parseICalSummary,
  extractHaresFromDescription,
  extractLocationFromDescription,
  extractCostFromDescription,
  extractMapsUrlFromDescription,
  extractOnOnVenueFromDescription,
  paramValue,
} from "@/adapters/ical/adapter";
import { safeFetch } from "@/adapters/safe-fetch";
import { googleMapsSearchUrl, isPlaceholder, compilePatterns } from "@/adapters/utils";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Charm City H3 iCal Feed";
const ICS_URL =
  "https://charmcityh3.com/?plugin=all-in-one-event-calendar&controller=ai1ec_exporter_controller&action=export_events&no_html=true";
const KENNEL_TIMEZONE = "America/New_York";

// Mirrors prisma/seed-data/sources.ts:541 ("Charm City H3 iCal Feed").
const KENNEL_PATTERNS: [string, string][] = [
  ["^CCH3", "cch3"],
  ["^Trail\\s*#", "cch3"],
];
const DEFAULT_KENNEL_TAG = "cch3";
const TITLE_HARE_PATTERN = "~\\s*(.+)$";

/** Format DTSTART/DTEND as YYYY-MM-DD in the event's original timezone. */
function formatDate(dt: DateWithTimeZone): string {
  if (dt.dateOnly) return dt.toISOString().split("T")[0];
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(dt);
  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** Format a DateWithTimeZone as HH:MM in its original timezone. */
function formatTime(dt: DateWithTimeZone): string | undefined {
  if (dt.dateOnly) return undefined;
  const tz = dt.tz || "UTC";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(dt);
  const h = parts.find((p) => p.type === "hour")!.value;
  const m = parts.find((p) => p.type === "minute")!.value;
  return `${h}:${m}`;
}

/** Resolve a locationUrl from GEO field, description Maps URL, or location name. */
function resolveLocationUrl(
  geo: VEvent["geo"],
  location: string | undefined,
  description: string | undefined,
): string | undefined {
  if (geo) {
    const { lat, lon } = geo;
    if (lat != null && lon != null) {
      return `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
    }
  }
  if (description) {
    const descUrl = extractMapsUrlFromDescription(description);
    if (descUrl) return descUrl;
  }
  if (location) return googleMapsSearchUrl(location);
  return undefined;
}

/** Build a RawEventData from a VEvent — replicates ICalAdapter buildRawEventFromVEvent for the CCH3 source config. */
function buildEvent(vevent: VEvent, titleHareRegex: RegExp): RawEventData | null {
  // Caller has already filtered CANCELLED events.
  const summary = paramValue(vevent.summary);
  if (!summary) return null;
  if (!vevent.start) return null;

  const parsed = parseICalSummary(summary, KENNEL_PATTERNS, DEFAULT_KENNEL_TAG);
  const dateStr = formatDate(vevent.start);
  const startTime = formatTime(vevent.start);
  const endDt = vevent.end as DateWithTimeZone | undefined;
  const endTime = endDt && formatDate(endDt) === dateStr ? formatTime(endDt) : undefined;

  const description = paramValue(vevent.description);
  let hares = description ? extractHaresFromDescription(description) : undefined;
  if (!hares) {
    const m = titleHareRegex.exec(summary);
    if (m?.[1]) {
      const captured = m[1].trim();
      if (captured) hares = captured;
    }
  }

  let location = paramValue(vevent.location);
  if (location && isPlaceholder(location)) location = undefined;
  if (!location && description) {
    location = extractLocationFromDescription(description) ?? extractOnOnVenueFromDescription(description);
  }

  const locationUrl = resolveLocationUrl(vevent.geo, location, description);
  const cost = description ? extractCostFromDescription(description) : undefined;

  return {
    date: dateStr,
    kennelTag: parsed.kennelTag,
    runNumber: parsed.runNumber,
    title: parsed.title ?? summary,
    description: description?.substring(0, 2000) || undefined,
    hares,
    location,
    locationUrl,
    startTime,
    endTime,
    cost,
    sourceUrl: paramValue(vevent.url) ?? undefined,
  };
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log(`\nFetching iCal feed: ${ICS_URL}`);
  const res = await safeFetch(ICS_URL, { headers: { "User-Agent": "HashTracks-Scraper" } });
  if (!res.ok) throw new Error(`iCal fetch failed: HTTP ${res.status}`);
  const icsText = await res.text();
  console.log(`  Bytes: ${icsText.length}`);

  const calendar = icalSync.parseICS(icsText);
  const titleHareRegex = compilePatterns([TITLE_HARE_PATTERN], "i")[0];

  const events: RawEventData[] = [];
  let totalVEvents = 0;
  let skippedNoSummary = 0;
  let skippedCancelled = 0;
  for (const key of Object.keys(calendar)) {
    const component = calendar[key];
    if (!component || typeof component !== "object" || !("type" in component)) continue;
    if (component.type !== "VEVENT") continue;
    totalVEvents++;
    const v = component as VEvent;
    if (v.status === "CANCELLED") {
      skippedCancelled++;
      continue;
    }
    const built = buildEvent(v, titleHareRegex);
    if (!built) {
      skippedNoSummary++;
      continue;
    }
    events.push(built);
  }
  console.log(
    `  VEVENTs: ${totalVEvents}, parsed: ${events.length}, skipped-cancelled: ${skippedCancelled}, skipped-no-summary: ${skippedNoSummary}`,
  );

  // Backfill owns date < today; recurring adapter (hardcoded 90d lookback)
  // owns the rest. reportAndApplyBackfill routes through processRawEvents,
  // so canonical Events are created in this pass.
  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
