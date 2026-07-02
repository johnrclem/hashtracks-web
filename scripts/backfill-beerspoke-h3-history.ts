/**
 * One-shot historical backfill for BeerSpoke H3 (beerspoke-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this monthly Edinburgh cycling
 * kennel's past runs (48 rows, 2019-02-23 → 2026-06-27 — the HC-join-forward
 * window) would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 2e2c1cd6-9c66-4e95-819d-91aeddf1fef1. description/cost omitted to match the live
 * adapter; UK bbox coord scrub + 06:00–21:59 time gate applied (two 23:00 rows had
 * their time dropped to undefined; date + venue preserved). Binds to the
 * "BeerSpoke H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-beerspoke-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-beerspoke-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/beerspoke-h3-history.json";

runBackfillScript({
  sourceName: "BeerSpoke H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen BeerSpoke H3 (beerspoke-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("beerspoke-h3-history.json is empty — expected ~48 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
