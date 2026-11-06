/**
 * One-shot historical backfill for Wyre Forest H3 (wfh3).
 *
 * The forward hareline (index.php) is forward-only; completed runs live on
 * `Page_on-back.php` — one SSR DataTables table with an ISO `data-order` date
 * on every row. Fetched through the residential proxy (the site answers 406
 * to datacenter IPs) and parsed with the adapter's own `parseWfRows`, frozen
 * 2026-11-05: 929 runs, #1 (1 May 2008) → #929 (5 Nov 2026). Run numbers are
 * unique and ascend with date; no duplicate dates. Early rows give an OS grid
 * reference instead of a postcode — kept out of locationStreet. startTime
 * 19:00 is set on Thursdays only (41 weekend/holiday specials stay unset).
 * The runner files only rows dated before "today", so #929 loads once it has
 * passed.
 *
 * Binds to "Wyre Forest HHH Website" (upcomingOnly:true → reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-wfh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-wfh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/wfh3-history.json";

runBackfillScript({
  sourceName: "Wyre Forest HHH Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Wyre Forest H3 (wfh3) run archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("wfh3-history.json is empty — expected 929 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
