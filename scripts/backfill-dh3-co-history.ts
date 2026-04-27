/**
 * DH3 Denver (Colorado) historical backfill. Issue #1012.
 *
 * Two upstream GOOGLE_CALENDAR sources feed DH3:
 *   1. "Denver H3 Google Calendar" (denverkennel@gmail.com) — 109 VEVENTs
 *      back to 2023-09; defaultKennelTag `dh3-co`. Live cron's
 *      scrapeDays=90 only reaches the most recent ~12 months.
 *   2. "Colorado H3 Aggregator Calendar" — kennelPatterns route DH3 / BH3 /
 *      MiHiHuHa events; ~13 DH3-tagged entries reach back to 2017-02.
 *
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed. The Aggregator
 * scrape also fills history for BH3 Boulder + MiHiHuHa (linked via
 * SourceKennel for that source); intentional side benefit.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-dh3-co-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-dh3-co-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

const SOURCES = [
  "Denver H3 Google Calendar",
  "Colorado H3 Aggregator Calendar",
];

async function main() {
  for (const sourceName of SOURCES) {
    console.log(`\n=== ${sourceName} ===`);
    await backfillGCalSource({
      sourceName,
      days: 4000,
      timezone: "America/Denver",
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
