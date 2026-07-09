/**
 * One-shot historical backfill for KRASH H3 (krashh3) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so this Kaiserslautern Military
 * Community kennel's past runs (36 rows = 28 counted trails + 8 #0 "Drinking
 * Practice" socials, 2024-05-01 → 2026-07-08) would never reach canonical Events
 * from the live scrape. At build there were 0 future runs posted (recently-active:
 * last run #32 was the day before), so without this backfill the page would be
 * empty. Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId c2a2b7ed-7717-49eb-9e0f-294086e15ef1. HC run numbers are
 * non-monotonic (#29 recurs, #0 socials); rows are keyed by date, not run#.
 * Germany bbox coord scrub + 06:00–21:59 time gate applied (no outliers found);
 * description omitted for live-adapter parity. Binds to "KRASH H3 Harrier Central"
 * (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-krashh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-krashh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/krashh3-history.json";

runBackfillScript({
  sourceName: "KRASH H3 Harrier Central",
  kennelTimezone: "Europe/Berlin",
  label: "Loading frozen KRASH H3 (krashh3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("krashh3-history.json is empty — expected ~36 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
