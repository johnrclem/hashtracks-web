/**
 * One-shot historical backfill for Plympton H3 (plympton-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this weekly Plymouth/Dartmoor
 * kennel's past runs (118 rows, 2024-04-28 → 2026-06-21 — the HC-join-forward
 * window) would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 901daedc-2ce5-47d8-9e63-e4c3cd9135da. description/cost omitted to match the live
 * adapter; UK bbox coord scrub + 06:00–21:59 time gate applied. Binds to the
 * "Plympton H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-plympton-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-plympton-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/plympton-h3-history.json";

runBackfillScript({
  sourceName: "Plympton H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Plympton H3 (plympton-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("plympton-h3-history.json is empty — expected ~118 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
