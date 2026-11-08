/**
 * One-shot historical backfill for Music City H3 (mch3-tn), Nashville, TN.
 *
 * The live "Music City H3 Events Calendar" source (shared TribeEventsAdapter) is
 * forward-only, so history is frozen here from a 2026-11-08 pull of the site's
 * Tribe calendar (418 events, 2015-03-06 → 2026-12-19): 320 trails,
 * 2015-03-07 → 2026-11-07, 304 with a run number. The site has no #1024–#1037.
 *
 * Curation when freezing:
 *  - Past rows only (date < 2026-11-08). Dropped 84 rows that aren't MCH3 trails:
 *    "Drinking Practice"/"DP" socials, planning meetings, 2015 cross-posted events
 *    from other kennels.
 *  - Dropped 4 cancelled/postponed runs (#873, #887, #899, #969) and 6 "Hare Needed"
 *    slots that never ran: their number was reused later or they collide with a
 *    real run (#888–#891 in early 2021, #935, a stray #985 in 2023).
 *  - "MCH3 #734" ("hares TBD") folded into its "Deliverance 24" row, with no endDate
 *    because the weekend's #735 and #736 have their own rows.
 *  - Dates corrected where the post's own "When:" contradicts the calendar entry:
 *    #979 → 2024-05-04, #991 → 2024-09-21, #956 → 2023-07-15.
 *  - endDate dropped on #982 (bogus 2024-06-01 → 06-29 span) and #956.
 *  - runNumber removed where a number repeats across dates (2020 COVID renumbering,
 *    #953 in 2023) — 15 rows. "MCH3 800th Hash!" gets #800.
 *  - #994's body had "When 11/16/2024" copied from #995; that date text is removed.
 *  - Placeholder "Hare Needed" descriptions removed. Email addresses and phone
 *    numbers in every string field redacted (re-scan: 0).
 *
 * Binds to the live source; its upcomingOnly config clamps reconcile to the future,
 * so these past rows are never cancelled.
 *
 *   Dry run:  npx tsx scripts/backfill-mch3-tn-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-mch3-tn-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/mch3-tn-history.json";

runBackfillScript({
  sourceName: "Music City H3 Events Calendar",
  kennelTimezone: "America/Chicago",
  label: "Loading frozen Music City H3 2015-2026 Tribe calendar history",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("mch3-tn-history.json is empty — expected 320 frozen events. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
