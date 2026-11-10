/**
 * One-shot historical backfill for Hellgate H3 (hellgate-h3, Missoula, MT).
 *
 * The live adapter reads only the latest 30 WordPress posts. The full archive
 * (158 posts, 2013-03-02 → 2026-01-03 publish dates) was fetched from
 * missoulahash.org/wp-json/wp/v2/posts on 2026-11-10 and run through the
 * adapter's own `parseHellgatePost`, so the frozen rows match what the live
 * adapter emits. 157 past runs, 2013-03-16 → 2026-10-17; the 158th post is the
 * upcoming 2026-11-21 run, which the live scrape publishes. No run numbers
 * exist on this source. Dates are unique.
 *
 * Curations (the parser can't date these; a corrected "When:" line was
 * prepended before parsing, checked against each post body):
 *   - "Campout Hash" (pub. 2024-07-30): 2024-08-09 → 08-11 (When: has ordinals but no month)
 *   - "Wino's 60th Birthday Hash Weekend!!!!" (2019-01-05): 2019-02-09 13:00, the hash day
 *     of a 4-day party; venue, hares and $15 hash cash from the post's schedule
 *   - "Erin Go Braless Hash Friday AND Saturday" (2017-02-13): 2017-03-17 → 03-18
 *   - "Bring out your Orgies Campout Hash" (2022-04-18): 2022-08-12 → 08-14
 *   - Hares cleared on two posts whose "Hares:" value is a CTA ("Pickup Hash – You
 *     could be a hare", "It's a surprise!").
 * Kept as published: "September Hash!" 2014-09-12 (body says Saturday; the 12th was
 * a Friday — can't tell which part is wrong). 12 campouts carry an endDate.
 *
 * Fill: hares 141, location 135, startTime 131, cost (non-$5) 95, description 157.
 * PII: phone numbers are stripped by the parser (5 in the archive); a scan of every
 * string field for emails and phone formats finds 0.
 *
 * Binds to "Hellgate H3 Website" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-hellgate-h3-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-hellgate-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/hellgate-h3-history.json";

runBackfillScript({
  sourceName: "Hellgate H3 Website",
  kennelTimezone: "America/Denver",
  label: "Loading frozen Hellgate H3 (hellgate-h3) post archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("hellgate-h3-history.json is empty — expected 157 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
