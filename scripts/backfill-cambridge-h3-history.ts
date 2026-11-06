/**
 * One-shot historical backfill for Cambridge H3 (cambridge-h3).
 *
 * The live adapter reads only the homepage's rolling ~7-run window. History is
 * frozen here (2026-11-05 browser-rendered pull of the Blazor /runlist page:
 * 21 accordion tables "Runs X-Y / Years A/B") — 1,040 runs, #1458
 * (9 Sep 2006) -> #2497 (1 Nov 2026), complete with no gaps in numbering.
 *
 * Rows carry only month sub-headers + ordinal days, so years were resolved by
 * walking runs newest -> oldest (each date = the latest date on or before the
 * newer run's date with that month/day) and checking every year against its
 * table's "Years A/B" caption (0 mismatches). Only one step > 40 days: the 2020
 * COVID pause before #2206 (91 days).
 *
 * Coordinates come from each row's OpenStreetMap venue link (mlat/mlon); the
 * venue phone numbers on the page are never captured. No start time is
 * published per run, so startTime is left unset.
 *
 * Binds to "Cambridge H3 Website" (upcomingOnly:true -> reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-cambridge-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-cambridge-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/cambridge-h3-history.json";

runBackfillScript({
  sourceName: "Cambridge H3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Cambridge H3 (cambridge-h3) 2006-2026 run list",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("cambridge-h3-history.json is empty — expected 1,040 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
