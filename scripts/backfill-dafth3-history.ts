/**
 * One-shot historical backfill for DAFT H3 (dafth3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this Dunfermline/Fife Tuesday
 * kennel's past runs (44 rows, 2022-11-01 → 2026-06-02 — the HC-join-forward
 * window) would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 9100fc6d-859a-4e8b-ba74-54c11a908939. description/cost omitted to match the live
 * adapter; UK bbox coord scrub + 06:00–21:59 time gate applied. Binds to the
 * "DAFT H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-dafth3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-dafth3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/dafth3-history.json";

runBackfillScript({
  sourceName: "DAFT H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen DAFT H3 (dafth3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("dafth3-history.json is empty — expected ~44 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
