/**
 * One-shot historical backfill for Herts H3 (herts-h3).
 *
 * `hertshash.co.uk/hare_line.htm` is forward-only, so the ~269 past runs
 * (run#+date only, no venue/hares) live on a separate `run_reports.htm`
 * listing. Frozen from that page (2026-08-14 pull), run #1904 (24 Aug 2020)
 * -> #2228 (10 Aug 2026).
 *
 * Corrections applied when freezing (the archive has real drift):
 *  - #2167 "20th July 2026" -> 2025 (sits between #2166/#2168, both 2025).
 *  - #2160 "16th June 2026" -> 2025 (sits between #2159/#2161, both 2025).
 *  - "#1960 17th September 2023" -> run number corrected to #2060 — a
 *    transposed-digit typo, not a date typo (it sits between #2057-59 and
 *    #2061 in run-number order; #1960 in the low-1900s range would break
 *    monotonicity by ~2 years).
 *  - "#2000 Weekend 23rd-25th September 2002" -> year corrected to 2022
 *    (missing digit; #1999/#2001 both sit in 2022).
 *  - Run #1904's year is missing on this pull ("24th August" with no year
 *    before the page rolls into the Virtual Hash section) — inferred 2020
 *    from the surrounding entirely-2020 context.
 *  - #2179 "5th October 2025" sits between #2180/#2176-78 (both September
 *    2025) — flagged as a likely typo by the research pass but with no
 *    independently-verifiable correction, so it ships as-is (Douliu/Prague
 *    faithful-data precedent: don't invent a fix with no independent source).
 *  - Weekend-bundle rows ("2225-6", "2222-4", "2176-78", "2133/34/35", ...)
 *    keep the base (first) run number rather than splitting into individual
 *    runs — this dataset has no per-day fields to split them into anyway.
 *  - "Virtual Hash No.1-22" (2020 COVID era) are excluded from the main
 *    series — no numeric run number, and mixing them in would break
 *    run-number monotonicity for no benefit.
 *  - A duplicated pair in the raw listing (#1910/#1911 appearing twice
 *    consecutively) dedupes to a single row per run number.
 *
 * Binds to "Herts H3 Website Hareline" (upcomingOnly:true -> reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-herts-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-herts-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/herts-h3-history.json";

runBackfillScript({
  sourceName: "Herts H3 Website Hareline",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Herts H3 (herts-h3) run-reports archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("herts-h3-history.json is empty — expected ~269 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
