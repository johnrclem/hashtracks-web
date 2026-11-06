/**
 * One-shot historical backfill for South Hams H4 (sh4).
 *
 * The live adapter reads the "List of Hashes" page, which carries the next
 * runs plus ~50 past rows (back to 03/12/25). Older runs come from the
 * separate `/historical-hashes/` page (`Hash NNNN – Venue – DD/MM/YY`),
 * frozen 2026-11-05: 546 runs from Hash 0001 (06/05/98) and Hash 947
 * (07/01/15) through Hash 1557 (30/11/25). Only rows older than the live
 * list's window are frozen, so the two never overlap.
 *
 * Freezing rules:
 *  - Venue = the page's venue text (no street/postcode on this page).
 *  - A theme in the link text becomes the title ("AGPU", "BBQ hash"); themes
 *    over 60 chars go to the description instead.
 *  - Three multi-day weekends listed as a date range ("Hash 1391 & 1392 -
 *    Away weekend – 03/02/23 - 05/02/23") are filed once on their first day
 *    under the first run number.
 *  - startTime 19:30 is set only on Wednesdays; weekend/holiday specials
 *    keep it unset (their real start times aren't on this page).
 * The archive has no gaps worth correcting: no duplicate dates, run numbers
 * ascend with date.
 *
 * Binds to "South Hams H3 (SH4) Website Hash Diary" (upcomingOnly:true →
 * reconcile never cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-sh4-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sh4-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sh4-history.json";

runBackfillScript({
  sourceName: "South Hams H3 (SH4) Website Hash Diary",
  kennelTimezone: "Europe/London",
  label: "Loading frozen South Hams H4 (sh4) historical-hashes archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sh4-history.json is empty — expected 546 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
