/**
 * One-shot historical backfill for North Hants H4 (nh4).
 *
 * The live source reads the forward "Run List" tab of the club's published
 * Google Sheet. Past runs live on a second tab (gid=179306928), frozen here
 * (2026-11-05 pull, built with the Google Sheets adapter's own
 * `buildEventFromSheetRow` and the same column map) — 53 runs, #2356
 * (5 Jan 2025) -> #2409 (25 Oct 2026). #2400 is not on the sheet. Older NH4
 * history (runs back to 1981) is not published in a structured form.
 *
 * Binds to "North Hants H4 Run List Sheet" (upcomingOnly:true -> reconcile
 * never cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-nh4-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nh4-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/nh4-history.json";

runBackfillScript({
  sourceName: "North Hants H4 Run List Sheet",
  kennelTimezone: "Europe/London",
  label: "Loading frozen North Hants H4 (nh4) 2025-2026 past-runs tab",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("nh4-history.json is empty — expected 53 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
