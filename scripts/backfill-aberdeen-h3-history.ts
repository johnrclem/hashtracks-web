/**
 * One-shot historical backfill for Aberdeen H3 (aberdeen-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this weekly Aberdeen kennel's past
 * runs (253 rows, 2021-08-16 → 2026-06-29 — the HC-join-forward window) would never
 * reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 79557c23-c531-4499-b5c2-36fe19af484c. description/cost omitted to match the live
 * adapter; UK bbox coord scrub + 06:00–21:59 time gate applied (5 recurring 23:00
 * rows had their time dropped to undefined — implausible for a 19:00-standard
 * kennel; date + venue preserved). Binds to the "Aberdeen H3 Harrier Central"
 * source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-aberdeen-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-aberdeen-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/aberdeen-h3-history.json";

runBackfillScript({
  sourceName: "Aberdeen H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Aberdeen H3 (aberdeen-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("aberdeen-h3-history.json is empty — expected ~253 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
