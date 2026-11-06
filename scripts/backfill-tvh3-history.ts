/**
 * One-shot historical backfill for Teign Valley H3 (tvh3).
 *
 * The live adapter reads only the latest ~30 Blogger posts. This loads the
 * 141 run-announcement posts the adapter's own parser (`parseTvh3Post`)
 * recognises across the full 955-post Blogger archive (paged via Blogger API
 * v3, frozen 2026-11-05): run #1984 (28 Aug 2023) → #2153 (2 Nov 2026).
 *
 * Older posts (2011 → mid-2023) are mostly recaps or a different announcement
 * layout (venue in a "VENUE:" label, no "Circle up" line) and are NOT included —
 * the deep archive is optional per the onboarding handoff.
 *
 * Two posts carry a stale day number copied from an earlier announcement
 * (#2045 "Monday 16th October" in 2024, #2100 "Monday 28th October" in 2025);
 * the parser snaps those onto the stated Monday (14 Oct 2024, 27 Oct 2025).
 *
 * Binds to "Teign Valley H3 Blogger Feed" (upcomingOnly:true → reconcile never
 * cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-tvh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-tvh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/tvh3-history.json";

runBackfillScript({
  sourceName: "Teign Valley H3 Blogger Feed",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Teign Valley H3 (tvh3) announcement archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("tvh3-history.json is empty — expected 141 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
