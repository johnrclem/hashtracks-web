/**
 * One-shot historical backfill for Heraultics H3 (heraultics) — HC config-only.
 *
 * The Harrier Central adapter is future-only, so this sporadic Hérault (Montpellier
 * / Agde / Sète) kennel's HC past runs (6 counted rows #6–#11, 2024-04-01 →
 * 2026-04-19) would never reach canonical Events from the live scrape. Frozen from
 * hashruns.org/api/global-runs?isFuture=0, filtered to PublicKennelId
 * dc7dc54b-422b-4c5b-b9fd-b29f265cef8a. Scrubs applied at freeze time: the
 * uncounted cancelled 2025-09-07 #10 slot dropped, #6 time typo 00:30 → 12:30
 * (blog-confirmed), description omitted for live-adapter parity. NO country bbox
 * scrub — #7 Helgoland and #10 Baltic-ferry are real away-runs (and #10's genuine
 * 22:30 ferry time is kept verbatim). Binds to "Heraultics H3 Harrier Central"
 * (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-heraultics-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-heraultics-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/heraultics-history.json";

runBackfillScript({
  sourceName: "Heraultics H3 Harrier Central",
  kennelTimezone: "Europe/Paris",
  label: "Loading frozen Heraultics H3 (heraultics) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("heraultics-history.json is empty — expected 6 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
