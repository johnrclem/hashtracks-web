/**
 * One-shot historical backfill for Donnington H3 (donnington-h3).
 *
 * The live adapter reads only the homepage's rolling forward table. History is
 * frozen here (2026-11-05 pull of the nine per-era archive pages, parsed with
 * the adapter's own `parseDonningtonTable`) — 2,358 runs, #1 (21 Jun 1976)
 * -> #2653 (1 Nov 2026).
 *
 * Source typos corrected when freezing (each with unambiguous evidence):
 *  - The 1976-2009 page labels Jan-Feb 1999 runs #1193-#1198 as "1993"-"1998"
 *    (the 1193-1199 numbering gap + the dates confirm it; the real #1993-#1998
 *    are 2013 rows on the 2010 page). Renumbered to #1193-#1198.
 *  - Six rows carry a year typo ("07 Apr 2024" for #1422 between 2003 runs).
 *    Fixed only when both immediate numeric neighbours agree on a year that
 *    places the date between them (#1422, #1508, #1523, #1533, #1580, #1587).
 *  - The 2018-2021 page uses #2326 twice (23 Sep and 29 Sep 2019); the second
 *    is kept as a distinct run without a run number.
 * Not corrected (no unambiguous fix): ~300 numbers never listed (e.g. #133-#216,
 * 1979-80), and a handful of small out-of-order dates in the 1989-2000 rows.
 * Rows without an integer run number (Christmas "No Trail", spacers) and
 * "Volunteer Required" venue placeholders are dropped/cleared by the parser.
 *
 * Binds to "Donnington H3 Website" (upcomingOnly:true -> reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-donnington-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-donnington-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/donnington-h3-history.json";

runBackfillScript({
  sourceName: "Donnington H3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Donnington H3 (donnington-h3) 1976-2026 archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("donnington-h3-history.json is empty — expected 2,358 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
