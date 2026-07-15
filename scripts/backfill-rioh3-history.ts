/**
 * One-shot historical backfill for Rio H3 (rioh3) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so Rio's past runs (3 rows,
 * #444 2026-04-11 → #446 2026-06-06) would never reach canonical Events from the
 * live scrape. At build there were 0 future runs posted (recently-active: monthly
 * cadence, last run ~5 weeks prior), so without this backfill the page would be
 * empty. Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId 8d230b92-a6e6-4d8b-8c13-fe004a260d25.
 *
 * Scrubs applied when freezing: Rio bbox (lat -23.15…-22.70 / lng -43.90…-43.00)
 * + 06:00–21:59 time gate (no outliers found); #446's venue-bleed `Hares` dropped
 * by the shared cleaner; `description` omitted for live-adapter fingerprint parity.
 * #446's EventName carries the source's own "466" typo — kept verbatim; runNumber
 * comes from EventNumber (446), which is authoritative.
 *
 * Binds to "Rio H3 Harrier Central" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-rioh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-rioh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/rioh3-history.json";

runBackfillScript({
  sourceName: "Rio H3 Harrier Central",
  kennelTimezone: "America/Sao_Paulo",
  label: "Loading frozen Rio H3 (rioh3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("rioh3-history.json is empty — expected 3 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
