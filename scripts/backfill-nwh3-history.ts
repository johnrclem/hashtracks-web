/**
 * One-shot historical backfill for nwh3.
 *
 * The live run sheet on nwh3.net is forward-only. This loads the yearly
 * run-records pages (same nested-<ul> markup), parsed with the adapter's own
 * `parseRunSheet` and frozen 2026-11-05:
 * 506 Sunday-series runs, #1565 (3 Jan 2016) → #2070 (1 Nov 2026), from runrecords.html + runrecords2016..2025.html. Pre-2016 pages (2013-2015) use a different layout and are not included; runrecords2014.html redirects. Six rows carry no parseable start time (e.g. "12 no0n" typos) and keep startTime unset. Run numbers are unique and ascend with date; no duplicate dates.
 * Rows are deduped by (run, date) and limited to dates before 2026-11-05.
 *
 * Binds to "North Wilts H3 Run Sheet" (upcomingOnly:true → reconcile never cancels these once
 * loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-nwh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nwh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/nwh3-history.json";

runBackfillScript({
  sourceName: "North Wilts H3 Run Sheet",
  kennelTimezone: "Europe/London",
  label: "Loading frozen nwh3 run-records archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("nwh3-history.json is empty — expected 506 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
