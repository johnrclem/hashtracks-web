/**
 * One-shot historical backfill for Milton Keynes H3 (mkh3).
 *
 * The live adapter reads only the near-term "Forthcoming Runs/Events" widgets.
 * History is frozen here (2026-11-05 pull of the club's published Google Sheet
 * linked from /history/past-runs — one tab per year, 1990–2025) — 1,865 runs,
 * #1 (28 May 1990) -> #1879 (17 Feb 2025). The sheet has not been updated
 * past Feb 2025, so 2025-03 → 2026-11 (≈ #1880–#1939) is not available.
 *
 * Curation when freezing:
 *  - The sheet also logs the sister "CUM" full-moon hash (its own #1–#66 series,
 *    2011–2019) and bike bashes (#1.5, #20.5, …) — excluded via the per-row
 *    kennel column; "No Run" / COVID-suspension / "-" rows skipped.
 *  - Two multi-run anniversary weekends listed as identical rows on one date
 *    range (#863–#866 Jul 2004, #1211–#1214 May 2010) are kept as their first
 *    run only; other weekend ranges use the first day. #1327–#1330 (one cell,
 *    Jun 2012) and #1237 (no month) are omitted.
 *  - One 1993 month typo ("Juk") read as July; times > 23:xx dropped.
 *  - A handful of out-of-order dates (#222/223, #470/471, #535/536, #670/671,
 *    #1186/1187) ship as published.
 *
 * Binds to "MKH3 Website" (upcomingOnly:true -> reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-mkh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-mkh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/mkh3-history.json";

runBackfillScript({
  sourceName: "MKH3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Milton Keynes H3 (mkh3) 1990-2025 run sheet",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("mkh3-history.json is empty — expected 1,865 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
