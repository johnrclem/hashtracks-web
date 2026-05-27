/**
 * One-shot cleanup for #1704 — Mosquito H3 3-RRULE phantom set.
 *
 * The Houston Hash umbrella Google Calendar (`hashvoice` gmail) contains THREE
 * separate `FREQ=MONTHLY` VEVENTs (1st Wed, 2nd Wed, 3rd Wed) all with
 * SUMMARY="Mosquito H3" and no UNTIL. The 2nd-Wed series is a mis-applied
 * recurrence on a 2025-01-08 annual sign-up event; the 1st/3rd-Wed series are
 * dormant duplicates of the STATIC_SCHEDULE rows we already trust. Together
 * they emit 36 future + 13 past phantom Wednesdays (12 per series ~).
 *
 * Discovery (prod DB, 2026-05-26): 49 rows under three eid prefixes, all
 * title="Mosquito H3 Trail" (kennel-shortName fallback), runNumber/hares/
 * location all NULL/empty. The `titleEquals` guard is belt-and-suspenders
 * against future GCal rows that might re-use the same eid prefix with a
 * different title (e.g. if a real one-off event gets created under the
 * dormant series ID). The hashrego.com campout row is already excluded by
 * `sourceUrlPrefixes` since it has a different domain entirely.
 *
 *   npm run tsx scripts/cleanup-mosquito-projections.ts           # preview
 *   npm run tsx scripts/cleanup-mosquito-projections.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "mosquito-h3",
    issues: [1704],
    // Three dormant monthly RRULEs on the same umbrella calendar.
    sourceUrlPrefixes: [
      "https://www.google.com/calendar/event?eid=YzRzbThvcG5jaGdtNGJi", // series A
      "https://www.google.com/calendar/event?eid=Xzk1aG0ycjFtYzhyM2Fj", // series B
      "https://www.google.com/calendar/event?eid=b2tmYnZpdG43aHFpZzhs", // series C
    ],
    titleEquals: "Mosquito H3 Trail",
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
