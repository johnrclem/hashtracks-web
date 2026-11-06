/**
 * One-shot historical backfill for N.E.W. Cotswold H3 (newch3).
 *
 * The homepage lists upcoming runs only; completed runs move to `/past/`
 * (same 5-column table). Frozen 2026-11-05 with the adapter's own
 * `parseRunTable`: 186 runs, #1 (13 Jan 2019) → #187 (25 Oct 2026). Run
 * numbers are unique and ascend with date; no duplicate dates. Two weekday
 * specials (one Monday, one Saturday) keep startTime unset.
 *
 * Binds to "N.E.W. Cotswold H3 Website" (upcomingOnly:true → reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-newch3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-newch3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/newch3-history.json";

runBackfillScript({
  sourceName: "N.E.W. Cotswold H3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen N.E.W. Cotswold H3 (newch3) /past/ archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("newch3-history.json is empty — expected 186 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
