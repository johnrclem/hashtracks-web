/**
 * One-shot historical backfill for Sembach H3 (sembach-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this ~biweekly Kaiserslautern
 * Military Community kennel's past runs (47 rows, 2023-07-01 → 2026-06-27 — the
 * HC-join-forward window) would never reach canonical Events from the live scrape.
 * (Sembach shows 0 upcoming right now, so without this backfill its page would be
 * empty.) Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId b19170aa-1cad-4c14-bee6-232d3061779d. HC run numbers are
 * non-monotonic on this kennel; rows are keyed by date (merge keys on kennel+date),
 * not run#. description/cost omitted to match the live adapter; Germany bbox coord
 * scrub + 06:00–21:59 time gate applied. Binds to the "Sembach H3 Harrier Central"
 * source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-sembach-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sembach-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sembach-h3-history.json";

runBackfillScript({
  sourceName: "Sembach H3 Harrier Central",
  kennelTimezone: "Europe/Berlin",
  label: "Loading frozen Sembach H3 (sembach-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sembach-h3-history.json is empty — expected ~47 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
