/**
 * One-shot historical backfill for Zagreb H4 (zh4, Zagreb, Croatia).
 *
 * The live GOOGLE_SHEETS source reads only the year tabs inside its 365-day
 * window. The "ZH4 RUN SCHEDULE" sheet keeps one tab per year back to 2010
 * (2010 in "Sheet2"). All 17 tabs were exported as CSV on 2026-11-12 and each
 * numbered row was run through the adapter's own `buildEventFromSheetRow` with
 * the seeded source config, so the frozen rows match what the live scrape
 * emits. 716 past runs, #1795 2010-01-02 → #2515 2026-10-31.
 *
 * Extraction rules:
 *   - 2010/2011 tabs use a Run | DayName | Time | Month | Day | Hare | Start layout
 *     (year from the tab); 2012+ use Run | Day | D.M.YYYY | Time | Hare | Start.
 *     Only columns 0–6 are read (2014/2019 tabs repeat their columns side by side).
 *   - Rows without a run number are skipped; a run seen in several tabs keeps the
 *     copy from the tab named for its year (2013's early-2014 rows are a week off).
 *   - Dropped, no date anywhere: #2345–#2352 (2019 tab), #2502 (2025 tab).
 *
 * Curated dates (neighbouring runs; run numbers are monotonic afterwards):
 *   #1800/#1801 → 2010-01-30/31 (month blank; 35-years weekend after #1799 29 Jan)
 *   #1869 "April 2" → 2011-05-02 · #1874 "May 6" → 2011-06-06 (Monday-evening slots)
 *   #1905 → 2012-01-02 (the 2011 tab's year-end preview of the anniversary run)
 *   #1908/#1909 "21.2"/"28.2.2012" → 2012-01-21/28 (between 14.1 and 4.2)
 *   #2147 "27.6.2016" → 2016-05-30 (between 23.5 and 7.6; the only Monday between)
 *   #2327 "9.9.2016" → 2019-09-09 · #2344 → 2020-01-02 · #2418 "5.9..2022" → 2022-09-05
 *   #2428/#2429 → 2023-01-02/14 (2022 tab carried the old year; 2023 tab agrees)
 *   #2501 "6.11.2025" → 2025-12-06 (after #2500 22.11.2025)
 * Other edits: #2060 "Hash Weekend" (same date and time as #2059) has no
 * startTime, so merge keeps both runs; #1797's hare is omitted (the hash name
 * contains a racial slur).
 *
 * Fill: hares 698, location 593, startTime 715, runNumber 716, title 0 (merge
 * synthesizes "Zagreb H4 Trail #N").
 * PII: one start-point line carrying a contact name + phone number (#1846) was
 * dropped before the Maps URL was built; a re-scan of every string field
 * (decoded URLs included) for emails and dashed / spaced / parenthesised /
 * 10-digit / 7-digit / international / Croatian-mobile numbers finds 0.
 *
 * Binds to "Zagreb H4 Run Schedule Sheet" (upcomingOnly:true → reconcile never
 * cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-zh4-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-zh4-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/zh4-history.json";

runBackfillScript({
  sourceName: "Zagreb H4 Run Schedule Sheet",
  kennelTimezone: "Europe/Zagreb",
  label: "Loading frozen Zagreb H4 (zh4) run-schedule archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("zh4-history.json is empty — expected 716 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
