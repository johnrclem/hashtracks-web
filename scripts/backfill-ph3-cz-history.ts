/**
 * One-shot historical backfill for Prague H3 (ph3-cz) — HC batch-11, config-only.
 *
 * The Harrier Central adapter is future-only, so Prague's past runs (26 rows,
 * 2023-06-03 → 2026-07-12, wider than the ~11-run window the onboarding handoff
 * originally sampled — a full sweep from 2023-06 recovered 15 additional rows)
 * would never reach canonical Events from the live scrape. 0 upcoming at build
 * (HC posts to this kennel sporadically), so without this backfill the page
 * would be empty. Frozen from hashruns.org/api/global-runs?isFuture=0, filtered
 * to PublicKennelId e7a4700c-beb3-4a5f-a05e-9ce019e5a610.
 *
 * Scrubs applied when freezing:
 *  - Czech Republic bbox (lat 48.5–51.1 / lng 12.0–18.9) — all 26 rows fall
 *    inside it (including the 2024-05-10 away-run near Turnov/Český Ráj).
 *  - PII scrub (emails, phone-like sequences) on `description`.
 *  - Title cleaning: bare `PH3 #NNNN` / `PH3#NNNN` / `PH3 # NNNN` placeholders
 *    (with no other content) → `title` undefined so merge synthesizes
 *    "Prague H3 #N"; real themes ("Zizkov Trivia Hash Revival!", "Thirsty
 *    Thursday", "Prelube Sloppy Vltava 2026", etc.) kept verbatim, including
 *    titles that merely *contain* a run number alongside real text (e.g.
 *    "Pre-Halloweenies Hash PH3 #1492").
 *  - `hares` "NA" placeholder → undefined.
 *  - `cost` composed from EventPriceForMembers/NonMembers ("100 CZK",
 *    "20/100 CZK", or "Free" when both are 0).
 *  - 🔴 EventNumber is kept FAITHFULLY, never renumbered — several 2023 rows
 *    carry visibly transposed digits (1943/1944/1945 instead of 1493/1494/
 *    1495), and #1495 legitimately appears twice on different dates (2024-03-02
 *    "PH3 # 1485" and 2024-05-10 "8th anal Český Ráj birthday hash!"). Do not
 *    "fix" these — the Douliu precedent (#193 dup, #165 named "#166") is to
 *    ship source data as-is; merge keys on kennel+date, so both survive.
 *
 * Binds to "Prague H3 Harrier Central" (upcomingOnly:true → reconcile never
 * cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-ph3-cz-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-ph3-cz-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/ph3-cz-history.json";

runBackfillScript({
  sourceName: "Prague H3 Harrier Central",
  kennelTimezone: "Europe/Prague",
  label: "Loading frozen Prague H3 (ph3-cz) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("ph3-cz-history.json is empty — expected ~26 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
