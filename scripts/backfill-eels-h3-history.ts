/**
 * One-shot historical backfill for EELS H3 (eels-h3) — HC batch-11, config-only.
 *
 * The Harrier Central adapter is future-only, so EELS's past runs (37 counted
 * rows, #24 2023-07-13 → #60 2026-08-06 — a wider and more recent window than
 * the ~30-run range the onboarding handoff sampled) would never reach
 * canonical Events from the live scrape. 0 upcoming at build (monthly
 * first-Thursday cadence, recently-active), so without this backfill the page
 * would show no history. Frozen from hashruns.org/api/global-runs?isFuture=0,
 * filtered to PublicKennelId 15940f8a-517e-4a13-b289-6709aaa259e9.
 *
 * Scrubs applied when freezing:
 *  - UK fail-safe bbox (lat 50.5–52.2 / lng -1.5…1.2) — all 37 rows are clean
 *    Greater-London pins.
 *  - PII scrub (emails, phone-like sequences) on `description`.
 *  - Titles kept verbatim — every HC EventName here is real ("EELS #N - Area"
 *    / "Run #N - Area"), no placeholders to synthesize.
 *  - `cost` intentionally omitted — HC price is £0 on every row, which the
 *    onboarding handoff flagged as unreliable (unconfirmed free-vs-unentered);
 *    do not synthesize a value.
 *  - 🔴 Dropped the two `IsCountedRun=0` away-weekend duplicate rows sharing
 *    run #49 (2025-08-16/17, "Rochester Away …") — the counted 2025-09-04
 *    "EELS #49 - Buckhurst Hill" is the real monthly run. Matches the Bandung/
 *    TITs uncounted-duplicate contract.
 *
 * Binds to "EELS H3 Harrier Central" (upcomingOnly:true → reconcile never
 * cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-eels-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-eels-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/eels-h3-history.json";

runBackfillScript({
  sourceName: "EELS H3 Harrier Central",
  kennelTimezone: "Europe/London",
  label: "Loading frozen EELS H3 (eels-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("eels-h3-history.json is empty — expected ~37 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
