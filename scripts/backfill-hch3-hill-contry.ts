/**
 * One-shot: load the seven 2010–11 Hill Country H3 runs (Trails 290, 292, 294,
 * 295, 297, 298, 300) that the first hch3-history.json freeze dropped. The
 * calendar titles them "Hill Contry H3 …", which strict kennel routing skipped.
 *
 * Loads ONLY those rows. Don't re-run backfill-hch3-history.ts in full for
 * this: kennelTags are part of the RawEvent fingerprint, and the 567 Humpin
 * rows retagged to hoth3-humpin on 2026-11-12 would be ingested again.
 *
 *   Dry run:  npx tsx scripts/backfill-hch3-hill-contry.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-hch3-hill-contry.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/hch3-history.json";

const DATES = new Set(["2010-10-16", "2010-11-13", "2010-12-11", "2010-12-25", "2011-01-08", "2011-01-22", "2011-02-19"]);

runBackfillScript({
  sourceName: "Hill Country H3 Calendar Archive",
  kennelTimezone: "America/Chicago",
  label: "Loading the 7 'Hill Contry' HCH3 runs (2010–11) missing from the first freeze",
  fetchEvents: async () => {
    const events = (history as RawEventData[]).filter((e) => DATES.has(e.date) && e.kennelTags.includes("hch3"));
    if (events.length !== DATES.size) {
      throw new Error(`Expected ${DATES.size} rows in hch3-history.json, found ${events.length}. Aborting.`);
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
