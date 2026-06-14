/**
 * One-shot historical backfill for New Taipei Hash House Harriers (nth3-tw).
 *
 * The live New Taipei Hash adapter (src/adapters/html-scraper/new-taipei-hash.ts)
 * only scrapes the current year's page (run_site_<YYYY>.htm), so the deep
 * archive (run #1 2013-01-06 → #666 2025-12-27) would never reach canonical
 * Events on its own.
 *
 * The archive was extracted once — parsed via the adapter's exported
 * `parseNewTaipeiHash` over the 13 yearly pages run_site_2013..2025.htm (year
 * taken from each filename) — and frozen into
 * `scripts/data/nth3-tw-history.json` (committed as data, no live parser, per
 * the H7 / Brasília lesson). PII phone numbers are stripped, the 2021 COVID
 * cancellations ("三級疫情取消" rows, run cell "X") are excluded, and the 2025
 * 2-day Chiang Mai special (runs 647+648) is recorded once as run #647. The
 * rows bind to the live "New Taipei Hash Run List" source (config.upcomingOnly
 * keeps reconcile.ts from cancelling these aged-off past runs).
 *
 * Known absences (faithful to the source page): runs #46, #577 are omitted by
 * the kennel's own pages; #648 is the second day of the combined Chiang Mai
 * special. 663 events total.
 *
 * Re-runnable: the backfill runner dedupes by fingerprint and loads only past
 * events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-nth3-tw-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nth3-tw-history.ts
 *
 * Requires the "New Taipei Hash Run List" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import nth3History from "./data/nth3-tw-history.json";

const SOURCE_NAME = "New Taipei Hash Run List";
const KENNEL_TIMEZONE = "Asia/Taipei";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated New Taipei Hash archive (2013–2025)",
  fetchEvents: async () => nth3History as RawEventData[],
}).catch((err) => {
  console.error(err);
  // Set exitCode (not process.exit) so the runner's Prisma disconnect / event
  // loop can drain cleanly before the process terminates.
  process.exitCode = 1;
});
