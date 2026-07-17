/**
 * One-shot historical backfill for Douliu H3 (douliu-h3, 斗六捷兔) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so Douliu's past runs (31 rows,
 * #159 2022-07-30 → #205 2026-05-30) would never reach canonical Events from the
 * live scrape. At build there were 0 future runs posted (recently-active: monthly
 * last-Saturday cadence, last run #205 ~6.5 weeks prior), so without this backfill
 * the page would be empty. Frozen from hashruns.org/api/global-runs?isFuture=0,
 * filtered to PublicKennelId 2b09b8c1-f236-4cce-8fcb-39114fd4f790.
 *
 * 🔴 INCOMPLETE ARCHIVE BY DESIGN: the kennel is at run #205 (founded 2009) but HC
 * only holds the ~31 runs the kennel actually entered (2022-07 onward, with gaps at
 * 2024-03→06, 2025-01→05, 2026-02→04). Ship what HC has; missing runs are NOT
 * synthesized and this is not a complete history.
 *
 * Scrubs applied when freezing:
 *  - Taiwan bbox (lat 21.5…25.5 / lng 119…122.5) + 06:00–21:59 time gate (no outliers).
 *  - `description` omitted for live-adapter fingerprint parity (2 rows also carried PII).
 *  - Title cleaning: HC EventNames drift badly. Bare-number names ("194", "#159") and
 *    "DH3 #N"-only names → `title` undefined so merge synthesizes "Douliu H3 #N";
 *    the "DH3 #N -" prefix is stripped off real themes; a remainder that is only a
 *    location/hare fragment ("in Changhua", "with CBB & Hand Solo") also synthesizes.
 *    14 genuine themes survive verbatim.
 *  - 🔴 Source-data quirks kept FAITHFULLY, never renumbered: EventNumber is
 *    authoritative over EventName (#165 is named "#166"; #201 is named "200"), and
 *    **#193 legitimately appears on two dates** (2025-05-24 "Jortspocalypse" +
 *    2025-06-28 "Frog Fucker's Revenge") — merge keys on kennel+date, so both persist.
 *
 * Binds to "Douliu H3 Harrier Central" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-douliu-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-douliu-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/douliu-h3-history.json";

runBackfillScript({
  sourceName: "Douliu H3 Harrier Central",
  kennelTimezone: "Asia/Taipei",
  label: "Loading frozen Douliu H3 (douliu-h3) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("douliu-h3-history.json is empty — expected ~31 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
