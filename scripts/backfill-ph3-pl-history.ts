/**
 * One-shot historical backfill for Poznan H3 (ph3-pl) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so Poznań's past runs (3 rows,
 * #11 2026-04-18 → #13 2026-06-13) would never reach canonical Events from the
 * live scrape. At build there were 0 future runs posted (recently-active: monthly
 * cadence, last run ~4 weeks prior), so without this backfill the page would be
 * empty. Frozen from hashruns.org/api/global-runs?isFuture=0, filtered to
 * PublicKennelId b193f2ad-a2b2-4f48-b8be-b7145423faaf.
 *
 * Scrubs applied when freezing: Poznań bbox (lat 52.30…52.55 / lng 16.70…17.15)
 * + 06:00–21:59 time gate (no outliers found); #12's venue-bleed `Hares`
 * ("Start point: Piwna Stopa, Brewery…") cleared, #11's real "Go Speed Racist"
 * kept; `description` omitted for live-adapter fingerprint parity. HC's garbled
 * EventNames ("POZH3 *UN #11", "PZNH3 ", "*un #13") route through the source's
 * staleTitleAliases + defaultTitle → "Poznan H3 #N".
 *
 * Binds to "Poznan H3 Harrier Central" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-ph3-pl-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-ph3-pl-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/ph3-pl-history.json";

runBackfillScript({
  sourceName: "Poznan H3 Harrier Central",
  kennelTimezone: "Europe/Warsaw",
  label: "Loading frozen Poznan H3 (ph3-pl) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("ph3-pl-history.json is empty — expected 3 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
