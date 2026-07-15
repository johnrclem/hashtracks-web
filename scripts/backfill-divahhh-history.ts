/**
 * One-shot historical backfill for Divahhh (divahhh) — Brussels women's hash, HC config-only.
 *
 * The Harrier Central adapter is future-only, so Divahhh's past runs (9 rows,
 * #36 2026-01-01 → #44 2026-07-09) would never reach canonical Events from the
 * live scrape. At build there were 0 future runs posted (recently-active: #44 ran
 * 3 days before the handoff), so without this backfill the page would be empty.
 * Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * 0ed7a8e6-3371-41cf-a539-753f3c07e944.
 *
 * Scrubs applied when freezing:
 *  - 🔴 NO coord bbox — the deliberate exception to the Rio/KRASH convention. Divahhh
 *    travels: #36 Leiden (NL), #38 Kaprun (AT), #39–#41 Carcassonne (FR) are REAL away
 *    runs; a Belgium box would drop 5 of 9.
 *  - 06:00–23:59 time gate (wider than the usual 21:59 — #44 is a real 19:30 pick-up hash).
 *  - Placeholder/bleed `Hares` cleared: #44 "Will be pulled from a hat!", #43 "Multiple
 *    Hares", #36 "Leiden" (venue). Real hare names kept.
 *  - `description` omitted for live-adapter fingerprint parity.
 *  - 🔴 #39/#40 are a genuine Walkers/Runners split of ONE slot (2026-04-18, both 09:30).
 *    merge.ts `upsertCanonicalEvent` collapses a same-date pair that shares startTime OR
 *    runNumber, which would silently drop one. They already differ on runNumber, so the
 *    Walkers row's startTime is cleared (no separately-published walkers' time) — both
 *    now survive as distinct canonicals.
 *
 * HC's KennelIANATimezone for this kennel is Europe/Berlin (a data quirk); the Brussels
 * metro is correctly Europe/Brussels — same offset, so times are unaffected.
 *
 * Binds to "Divahhh Harrier Central" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-divahhh-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-divahhh-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/divahhh-history.json";

runBackfillScript({
  sourceName: "Divahhh Harrier Central",
  kennelTimezone: "Europe/Brussels",
  label: "Loading frozen Divahhh (divahhh) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("divahhh-history.json is empty — expected 9 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
