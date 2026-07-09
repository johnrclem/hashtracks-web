/**
 * One-shot historical backfill for Try it Thursdays H3 (titsh3) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so this weekly Callington/Cornwall
 * kennel's past runs (113 rows, 2024-04-25 → 2026-07-02 — the HC-join-forward
 * window) would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 2cc90a71-62e8-40ea-b26e-c79aed6fc417. Scrubs applied at freeze time:
 * IsCountedRun=0 rows dropped (#1565), Devon/Cornwall bbox coord scrub (drops the
 * #1567 Frankfurt geocode-fail pin → merge re-geocodes), 06:00–20:00 time gate,
 * placeholder "Required please 🙏🏼" hares nulled, description omitted for
 * live-adapter parity. Binds to "Try it Thursdays H3 Harrier Central"
 * (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-titsh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-titsh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/titsh3-history.json";

runBackfillScript({
  sourceName: "Try it Thursdays H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Try it Thursdays H3 (titsh3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("titsh3-history.json is empty — expected ~113 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
