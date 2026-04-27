/**
 * Bushman H3 (BMH3 Chicago) historical backfill. Issue #1008.
 *
 * Source "Chicagoland Hash Calendar" exposes ~103 one-off Bushman VEVENTs
 * back to 2016-03-19; recurring `scrapeDays=365` discards everything older.
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed. Same scrape
 * also fills history for other Chicagoland kennels routed via the source's
 * kennelPatterns (CH3, TH3, CFMH3, BDH3, etc.) — deliberate side benefit.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-bushman-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-bushman-h3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "Chicagoland Hash Calendar",
  days: 4000,
  timezone: "America/Chicago",
});
