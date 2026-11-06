/**
 * One-shot historical backfill for Surrey H3 (surrey-h3).
 *
 * The live adapter reads only the rolling forward hareline. History is frozen
 * here (2026-11-05 pull) — 257 runs, #2398 (2 Jan 2022) -> #2649 (1 Nov 2026):
 *  - #2398–#2616 from the /archive-runday-shags/ <table>
 *    (Issue no. | Date "DD Mon 'YY" | Hare(s) | Location | On-on | Directions).
 *    The "rs n/a" No-trail row is dropped. Five lettered extra runs
 *    (rs2416a/2435a/2504a/2513a/2568a) keep their label in the title, carry no
 *    runNumber/startTime (not in the numbered sequence; also keeps 2435a from
 *    collapsing into same-day #2435 in merge).
 *  - #2617–#2649 (not yet on the archive table) from the per-run
 *    /trail-<n>-<d>-<month>/ pages, walked via their "Previous trail" links.
 *    #2634's page omits the year; its date comes from the slug (2026).
 * Pre-2022 run sheets are PDFs in an off-site Drive folder — out of scope.
 *
 * Binds to "Surrey H3 Website Hareline" (upcomingOnly:true -> reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-surrey-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-surrey-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/surrey-h3-history.json";

runBackfillScript({
  sourceName: "Surrey H3 Website Hareline",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Surrey H3 (surrey-h3) run archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("surrey-h3-history.json is empty — expected 257 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
