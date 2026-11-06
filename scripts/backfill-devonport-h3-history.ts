/**
 * One-shot historical backfill for Devonport H3 (devonport-h3).
 *
 * The live adapter reads the latest ~15 Blogger posts. This loads every
 * labelled `Run NNNN` announcement (Hare / Where / When / Cost) the adapter's
 * own parser (`parseAnnouncement`) recognises across the full 1,427-post
 * archive (paged via Blogger API v3, frozen 2026-11-05): 88 runs, #2208
 * (1 Apr 2024) → #2331 (31 Aug 2026), all Mondays, no duplicate dates.
 *
 * Posts before April 2024 are free-form prose (recaps, notices, socials) with
 * no labelled fields and are not included. Receding-hareline rows are not
 * backfilled: they are forward-looking and superseded edit-by-edit.
 *
 * Binds to "Devonport H3 Blogger Feed" (upcomingOnly:true → reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-devonport-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-devonport-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/devonport-h3-history.json";

runBackfillScript({
  sourceName: "Devonport H3 Blogger Feed",
  kennelTimezone: "Australia/Hobart",
  label: "Loading frozen Devonport H3 (devonport-h3) announcement archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("devonport-h3-history.json is empty — expected 88 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
