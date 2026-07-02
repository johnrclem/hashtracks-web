/**
 * One-shot historical backfill for Newcastle H3 (newcastle-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this weekly Newcastle kennel's
 * past runs (107 rows, 2024-09-01 → 2026-07-01 — the HC-join-forward window) would
 * never reach canonical Events from the live scrape. (Newcastle currently shows 0
 * upcoming — its weekly run just passed — so without this backfill its page would
 * be empty.) Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId f1266de7-9bdc-4cb7-95ca-4846fd7aa01c. description/cost omitted to
 * match the live adapter; UK bbox coord scrub + 06:00–21:59 time gate applied.
 * Binds to the "Newcastle H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-newcastle-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-newcastle-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/newcastle-h3-history.json";

runBackfillScript({
  sourceName: "Newcastle H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Newcastle H3 (newcastle-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("newcastle-h3-history.json is empty — expected ~107 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
