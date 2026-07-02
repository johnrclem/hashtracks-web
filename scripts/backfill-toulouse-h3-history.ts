/**
 * One-shot historical backfill for Toulouse H3 (toulouse-h3) — HC config-only batch.
 *
 * The Harrier Central adapter is future-only, so this monthly Toulouse kennel's
 * past runs (4 rows, 2026-03-15 → 2026-06-14 — the shallow HC-join-forward window)
 * would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 9fa2eab8-a905-490a-a509-23b5c98e6061. description/cost omitted to match the live
 * adapter; France bbox coord scrub + 06:00–21:59 time gate applied (#293's 02:30
 * — a known HC data glitch, cf. the live #295 — had its time dropped to undefined).
 * Binds to the "Toulouse H3 Harrier Central" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-toulouse-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-toulouse-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/toulouse-h3-history.json";

runBackfillScript({
  sourceName: "Toulouse H3 Harrier Central",
  kennelTimezone: "Europe/Paris",
  label: "Loading frozen Toulouse H3 (toulouse-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("toulouse-h3-history.json is empty — expected ~4 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
