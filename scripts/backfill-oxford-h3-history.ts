/**
 * One-shot historical backfill for Oxford H3 (oxford-h3).
 *
 * The live adapter reads only the homepage "Hash Diary". History is frozen
 * here (2026-11-05 pull of /run-list-3-2/, parsed with the adapter's own
 * `parseOxfordTables`) — 515 rows, #875 (30 Sep 2015) -> #1369 (21 Oct 2026).
 * Runs #1–#874 (1999–2015) exist only in a .docx download — out of scope.
 *
 * Curation when freezing:
 *  - "NO HASH" / "No run this week…" rows dropped (parser rule).
 *  - Two exact duplicate rows (#1123, #1188) collapsed.
 *  - Run numbers reused on two dates (#1076, #1153, #1169, #1328): the number
 *    stays on the row that sits between its numeric neighbours; the other row
 *    is kept unnumbered.
 *  - The archive's tail columns (Beer Master / Chef / Tick / Parking) are
 *    misaligned on many rows, so no description is carried.
 *  - ~18 numbers were never listed (e.g. #894, #908); #1000 and #1056/#1057
 *    sit out of date order — shipped as published.
 *
 * Binds to "Oxford H3 Website" (upcomingOnly:true -> reconcile never cancels
 * these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-oxford-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-oxford-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/oxford-h3-history.json";

runBackfillScript({
  sourceName: "Oxford H3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Oxford H3 (oxford-h3) 2015-2026 run list",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("oxford-h3-history.json is empty — expected 515 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
