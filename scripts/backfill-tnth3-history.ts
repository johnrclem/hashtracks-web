/**
 * One-shot historical backfill for The New Town Hash (tnth3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this weekly Edinburgh kennel's
 * past runs (216 rows, 2022-07-20 → 2026-07-01 — the HC-join-forward window) would
 * never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 594bea0c-35fb-4259-9207-a59de10e6935. description/cost omitted to match the live
 * adapter; UK bbox coord scrub + 06:00–21:59 time gate applied. Binds to the
 * "The New Town Hash Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-tnth3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-tnth3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/tnth3-history.json";

runBackfillScript({
  sourceName: "The New Town Hash Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen The New Town Hash (tnth3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("tnth3-history.json is empty — expected ~216 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
