/**
 * One-shot historical backfill for City of Exeter H3 (coeh3).
 *
 * The live adapter reads the latest ~25 Blogspot recaps. This loads every
 * recap whose title the adapter's own parser (`parseCoeh3Title`) recognises
 * across the full 1,089-post Blogger archive (paged via Blogger API v3,
 * frozen 2026-11-05): 200 runs, #984 (4 Oct 2020) → #1281 (25 Oct 2026).
 *
 * - Pre-Oct-2020 posts have no run number in the title ("28th December -
 *   Stoke Woods - Groucho") and are not included.
 * - Six numbered titles carry no date (#1059, #1098, #1102, #1224, #1242,
 *   #1272) and are skipped rather than guessed.
 * - The year always comes from the publish date (closest-to-publish), so
 *   "#1186 … 22 Dec 2025", posted Dec 2024, is filed on 2024-12-22.
 * - Two posts were published twice (#1202, #1205) — deduped by (run, date).
 * - Source quirks kept as published: #987 and #1151 each appear on two
 *   consecutive Sundays; #1269 is dated "1 Aug 2026" (a Saturday).
 *
 * Binds to "City of Exeter H3 Blogspot Recaps" (upcomingOnly:true → reconcile
 * never cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-coeh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-coeh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/coeh3-history.json";

runBackfillScript({
  sourceName: "City of Exeter H3 Blogspot Recaps",
  kennelTimezone: "Europe/London",
  label: "Loading frozen City of Exeter H3 (coeh3) recap archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("coeh3-history.json is empty — expected 200 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
