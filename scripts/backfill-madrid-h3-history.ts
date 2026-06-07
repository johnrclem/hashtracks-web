/**
 * One-shot historical backfill for Madrid H3 (madrid-h3) — HashTracks' 2nd
 * Spain kennel.
 *
 * The Madrid HHH adapter (src/adapters/html-scraper/madrid-hash.ts) fetches
 * only the latest ~30 WordPress posts each scrape, so the full archive
 * (run #2106 2015-06 → #2712 2025-05) would never reach canonical Events on
 * its own. The source carries `config.upcomingOnly: true`, so reconcile.ts only
 * cancels stale *future* events and never these aged archives.
 *
 * The archive was extracted once (parsed via the adapter's exported
 * `parseMadridRunBody` over the live WordPress REST feed, with each post's
 * publish date threaded in so the year-less / typo'd / copy-pasted body dates
 * the 11-year archive carries resolve correctly) and frozen into
 * `scripts/data/madrid-h3-history.json` — committed as data, no parser, per the
 * H7 / Brasília / Asunción lesson. The rows bind to the live "Madrid HHH
 * WordPress Trail Directions" source (the same sourceUrl the recurring adapter
 * scrapes).
 *
 * Faithful source quirks preserved (not "fixed"): run #1 (a 2020 COVID
 * "Virtually Unofficial" virtual run) and run #2659 (a source run-number
 * mistype on a date-correct 2023-11-19 post) are kept verbatim — the merge
 * pipeline keys on (kennel, date), and both dates are publish-corroborated.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-madrid-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-madrid-h3-history.ts
 *
 * Requires the "Madrid HHH WordPress Trail Directions" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import madridHistory from "./data/madrid-h3-history.json";

const SOURCE_NAME = "Madrid HHH WordPress Trail Directions";
const KENNEL_TIMEZONE = "Europe/Madrid";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated Madrid H3 WordPress archive",
  fetchEvents: async () => madridHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  // Set exitCode (not process.exit) so the runner's Prisma disconnect / event
  // loop can drain cleanly before the process terminates.
  process.exitCode = 1;
});
