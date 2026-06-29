/**
 * One-shot historical backfill for Creek H3 (Dubai, UAE) — `ch3-ae`.
 *
 * creekhash.org publishes a deep "Creek Runs" archive (/?cat=4, ~38 pages) of
 * dated run posts back to 2001. The live CreekHashAdapter only ingests the
 * current run from the home "This Week's Meet Point" block, so the pre-current
 * archive (Run 1000 @ 2001 → the most recent run) would never reach canonical
 * Events without this backfill.
 *
 * The archive was extracted once — walking the listing pages and parsing each
 * title via the adapter's exported `parseRunTitle` (date + run# + venue) — and
 * frozen to `scripts/data/ch3-ae-history.json` (545 main-series runs, year-bearing
 * dates so no inference). Two things were filtered at extraction time:
 *   - non-"Run N" labels (Spit Roast, Curry Club, Xmas, etc. — their own series), and
 *   - the COVID-era "Virtual Creek" (VCH3) sub-series, which restarted numbering at
 *     1–20 in 2020 while the main series paused at #1997; any sub-1000 run number in
 *     the category is that virtual series, not a real Creek run.
 * Listing-only: no hares/maps/time (the home/detail scrape enriches the current run).
 *
 * Rows bind to the "Creek H3 Website" source for provenance. `reportAndApplyBackfill`
 * partitions to date < today and dedupes by fingerprint, so this is re-runnable and
 * only writes past events (the live adapter owns the current/future run).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-ch3-ae-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-ch3-ae-history.ts
 *
 * Requires the "Creek H3 Website" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import ch3History from "./data/ch3-ae-history.json";

const SOURCE_NAME = "Creek H3 Website";
const KENNEL_TIMEZONE = "Asia/Dubai";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Creek H3 'Creek Runs' archive",
  fetchEvents: async () => ch3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
