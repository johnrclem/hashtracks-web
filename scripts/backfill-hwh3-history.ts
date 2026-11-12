/**
 * One-shot historical backfill for High Wycombe H3 (hwh3).
 *
 * The live adapter reads only the home-page Runs list (~7 weeks ahead). The
 * kennel's own archive at hwh3.co.uk/hashes/?y=YYYY holds one table per year
 * (No. / Date / Where / Hare / Distance / Hilliness). A throwaway parser over
 * ?y=2008 … ?y=2026 froze it on 2026-11-10: 919 past runs, #916 (1 Jul 2008)
 * → #1878 (3 Nov 2026). #1879 (10 Nov 2026) was added on 2026-11-12: it left the
 * live Runs list before the first prod scrape, so neither source had it. Its
 * 19:45 start is from the live list seen on 2026-11-10. Run numbers are unique and never go backwards in
 * date; 44 numbers are absent on the site (e.g. 996–998, 1100–1114) and are not
 * invented. #994 and #995 share 22 Dec 2009 on the site; they differ on run
 * number, so merge keeps both.
 *
 * Per row: runNumber, date, location = the "Where" cell as shown (3 "tba" rows
 * have none), hares = the displayed hash names sorted (10 rows have none; the
 * /hashers/<slug>/ links are never stored), trailLength* from the "km" distance
 * (664 rows; miles = km ÷ 1.609344, 2 dp). No startTime: the archive has none.
 * PII scan (emails, phone formats) over every string field: 0 hits.
 *
 * Binds to "High Wycombe H3 Website" (upcomingOnly:true → reconcile never
 * cancels these). The runner files only rows dated before "today".
 *
 *   Dry run:  npx tsx scripts/backfill-hwh3-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-hwh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/hwh3-history.json";

runBackfillScript({
  sourceName: "High Wycombe H3 Website",
  kennelTimezone: "Europe/London",
  label: "Loading frozen High Wycombe H3 (hwh3) run archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("hwh3-history.json is empty — expected 920 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
