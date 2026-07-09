/**
 * One-shot historical backfill for Lyon H3 (lh3-fr) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so this Rhône-valley kennel's past
 * runs (25 rows = its full HC lifetime #1–#25, 2024-11-02 → 2026-06-14) would
 * never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 8b8aca36-a3c1-4867-adff-3ee24cac6822. Scrubs applied at freeze time:
 * clerical time typos normalized (#21 02:00 / #22 00:00 → 14:00), venue-as-hare
 * bleed dropped (#25 "Passerelle du Collège"), description omitted for
 * live-adapter parity; the 19/25 real coords kept, 6 nulls geocode on merge.
 * Binds to "Lyon H3 Harrier Central" (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-lh3-fr-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lh3-fr-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/lh3-fr-history.json";

runBackfillScript({
  sourceName: "Lyon H3 Harrier Central",
  kennelTimezone: "Europe/Paris",
  label: "Loading frozen Lyon H3 (lh3-fr) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("lh3-fr-history.json is empty — expected 25 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
