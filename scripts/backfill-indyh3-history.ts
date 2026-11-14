/**
 * One-shot historical backfill for IndyScent H3 (indyh3) + THICC H3 (thicch3) — #1353.
 *
 * The live adapter reads only the "Upcumming Hashes" page (`upcomingOnly: true`),
 * so runs that aged off that page before HashTracks saw them never reached
 * canonical Events. Frozen 2026-11-13 from two indyhhh.com surfaces:
 *   - 6 `ht_hash_event` detail pages (#1115–#1118, #1123, #1130) — run number from
 *     the <h1> (slugs lag), time/hares/Maps coords + parseIndyDetail description.
 *     #1117 "THICC Moon" routes to thicch3 by the source's own /THICC/ title rule.
 *   - 28 rows from 27 "Hash Trash" WordPress posts (2016–2022): title-only
 *     (date, run number, theme). #800-802 "Banned Camp" weekend = 3 rows.
 *     #857's title says "Saturday January 19, 2020" (a Sunday); the explicit
 *     date is kept.
 * Emails/phones redacted; #1130's payment block dropped. Binds to the
 * "IndyScent H3 Upcumming Hashes" source (linked to both kennels).
 *
 *   Dry run:  npx tsx scripts/backfill-indyh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-indyh3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/indyh3-history.json";

runBackfillScript({
  sourceName: "IndyScent H3 Upcumming Hashes",
  kennelTimezone: "America/Indiana/Indianapolis",
  label: "Loading frozen IndyScent H3 / THICC H3 archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("indyh3-history.json is empty — expected 34 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
