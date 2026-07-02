/**
 * One-shot historical backfill for Brazil Nuts H3 (bnh3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this São Paulo kennel's past runs
 * (6 rows, 2025-12-20 → 2026-06-06 — the shallow HC-join-forward window) would
 * never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 10b3befa-4b38-49b5-b68b-95ad07d4b087. description/cost omitted to match the live
 * adapter (+ strip any HC EventDescription PII); Brazil bbox coord scrub +
 * 06:00–21:59 time gate applied at extraction. Binds to the "Brazil Nuts H3
 * Harrier Central" source (upcomingOnly:true → reconcile never false-cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-bnh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bnh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/bnh3-history.json";

runBackfillScript({
  sourceName: "Brazil Nuts H3 Harrier Central",
  kennelTimezone: "America/Sao_Paulo",
  label: "Loading frozen Brazil Nuts H3 (bnh3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("bnh3-history.json is empty — expected ~6 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
