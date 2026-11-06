/**
 * One-shot historical backfill for Quorn H3 (quorn-h3).
 *
 * The live adapter reads only the current (and next) year's runlog<YYYY>.xml.
 * History is frozen here (2026-11-05 pull of runlog2014.xml … runlog2026.xml,
 * parsed with the adapter's own `parseQuornRunlog`; 2006–2013 files 404) —
 * 326 runs, #819 (5 Jan 2014) -> #1144 (1 Nov 2026), deduped by run number
 * (a year file can forward-list next January's run). "0000" ***CANCELLED***
 * placeholders are skipped by the parser. Shipped as published, including a
 * few out-of-sequence dates (#844/#845 in 2014, the 2020 COVID gap).
 *
 * Binds to "Quorn H3 Runlog XML" (upcomingOnly:true -> reconcile never cancels
 * these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-quorn-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-quorn-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/quorn-h3-history.json";

runBackfillScript({
  sourceName: "Quorn H3 Runlog XML",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Quorn H3 (quorn-h3) 2014-2026 run log",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("quorn-h3-history.json is empty — expected 326 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
