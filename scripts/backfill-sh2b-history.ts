/**
 * One-shot historical backfill for SH2B / Seattle Hash House Bikers (sh2b) —
 * HC batch-11, config-only.
 *
 * The Harrier Central adapter is future-only, so SH2B's past runs (19 rows,
 * #43 2023-06-11 → #61 2026-07-19 — a wider window than the ~15-run range
 * the onboarding handoff sampled) would never reach canonical Events from the
 * live scrape. **Note:** the handoff observed 0 upcoming (seasonal pause);
 * by build time the 2026 season had resumed and run #62 (2026-08-16) is now
 * live on the future feed — that row is correctly EXCLUDED from this backfill
 * (date >= today) and is left for the live adapter to pick up on its own
 * scrape, per the future-only/past-only partition every HC backfill honors.
 * Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId 72a5b2f7-0942-4157-b301-557701eb242e.
 *
 * Scrubs applied when freezing:
 *  - WA bbox (lat 47.0–48.3 / lng -122.7…-121.5) — all 19 rows are clean
 *    Puget-Sound pins.
 *  - PII scrub (emails, phone-like sequences) on `description` (ride notes
 *    sometimes carry venue street addresses — public venues, low risk, but
 *    scrubbed anyway).
 *  - Titles kept verbatim after whitespace trim (HC's own EventName carried a
 *    leading space on #58, " SH2B #58 (Tour De Franzia)"); every name here is
 *    a real theme, no placeholders to synthesize.
 *  - `cost` intentionally omitted — HC price ranges 0–5 USD across rows,
 *    which the onboarding handoff flagged as unreliable; do not synthesize.
 *  - `locationStreet` populated when HC supplied a distinct street field
 *    (present on some rows, not all).
 *
 * Binds to "Seattle Hash House Bikers Harrier Central" (upcomingOnly:true →
 * reconcile never cancels these; seasonal winter dormancy is expected, not
 * staleness).
 *
 *   Dry run:  npx tsx scripts/backfill-sh2b-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sh2b-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sh2b-history.json";

runBackfillScript({
  sourceName: "Seattle Hash House Bikers Harrier Central",
  kennelTimezone: "America/Los_Angeles",
  label: "Loading frozen SH2B (sh2b) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sh2b-history.json is empty — expected ~19 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
