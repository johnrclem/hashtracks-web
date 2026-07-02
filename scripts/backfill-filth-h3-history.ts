/**
 * One-shot historical backfill for FILTH H3 (filth-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this monthly Haarlem/Heemstede
 * kennel's past runs (113 rows, 2019-01-21 → 2026-06-30 — the HC-join-forward
 * window) would never reach canonical Events from the live scrape. (FILTH shows 0
 * upcoming right now, so without this backfill its page would be empty.) Frozen
 * from hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 4483b884-e862-44ca-b52a-d95c9e876d4b. description/cost omitted to match the live
 * adapter; Netherlands bbox coord scrub (3 out-of-box away-trip pins → re-geocoded
 * from venue text) + 06:00–21:59 time gate applied (genuine NL summer 21:00–21:30
 * evening starts kept; only two 00:00 "no-time" defaults dropped). Binds to the
 * "FILTH H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-filth-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-filth-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/filth-h3-history.json";

runBackfillScript({
  sourceName: "FILTH H3 Harrier Central",
  kennelTimezone: "Europe/Amsterdam",
  label: "Loading frozen FILTH H3 (filth-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("filth-h3-history.json is empty — expected ~113 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
