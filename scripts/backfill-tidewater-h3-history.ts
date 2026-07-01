/**
 * One-shot historical backfill for the Tidewater H3 family (tidewaterh3.org).
 *
 * The TidewaterH3Adapter parses the inline `trailCalendarEvents` FullCalendar
 * feed on /calendar, but `parseTidewaterCalendar` deliberately DROPS past
 * entries (the live scrape only ever surfaces upcoming runs + in-window
 * placeholders). The feed itself, however, still carries recently-completed
 * REAL trails — fully detailed via each entry's `extendedProps` (hares, venue +
 * address, maps URL, cost, description). Those past trails never reach canonical
 * Events from the live scrape, which is the gap reported in #2429 (HOBO H3) and
 * the same shape for any sibling kennel.
 *
 * This script re-uses the adapter's own `extractCalendarArray` +
 * `parseCalendarEntry` so the rows are byte-identical to what the live adapter
 * would have stored, then routes the PAST, NON-placeholder slice through the
 * merge pipeline. Placeholder ("schedule"/TBD) entries are skipped — they carry
 * no run#/hares/location and aren't worth a canonical Event (#2432 disposition).
 *
 * Generic by design: it imports EVERY past real trail the live feed exposes
 * (currently HOBO 06-25, VBFMH3 06-26, TH3 #1852 06-28), not just the issue's
 * one event. `processRawEvents` dedupes by fingerprint, so already-held events
 * skip and re-running is a no-op. The source carries `config.upcomingOnly:true`,
 * so reconcile never false-cancels these past rows.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-tidewater-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-tidewater-h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import {
  extractCalendarArray,
  parseCalendarEntry,
} from "@/adapters/html-scraper/tidewater-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Tidewater H3 Website Calendar";
const SOURCE_URL = "https://tidewaterh3.org/calendar";
// Hampton Roads, VA.
const KENNEL_TIMEZONE = "America/New_York";

async function fetchEvents(): Promise<RawEventData[]> {
  const res = await safeFetch(SOURCE_URL);
  if (!res.ok) throw new Error(`Tidewater calendar returned HTTP ${res.status}`);
  const html = await res.text();

  const entries = extractCalendarArray(html);
  if (!entries) {
    throw new Error(
      "Tidewater calendar: inline trailCalendarEvents feed not found (page shape changed).",
    );
  }

  const events: RawEventData[] = [];
  for (const entry of entries) {
    const parsed = parseCalendarEntry(entry, SOURCE_URL);
    if (!parsed) continue;
    // Skip placeholders (schedule/TBD rows): no run#/hares/location to preserve.
    if (parsed.isPlaceholder) continue;
    events.push(parsed.event);
    // The runner partitions to `date < today`, so future real entries (already
    // covered by the live adapter) are reported-then-skipped, not written.
  }

  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Tidewater H3 calendar feed for past real trails",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
