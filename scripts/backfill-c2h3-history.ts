/**
 * One-shot historical backfill for C2H3 (Corpus Christi). Issue #995.
 *
 * Source "Corpus Christi H3 Calendar" exposes 236 VEVENTs back to
 * 2019-08-17, but the recurring `scrapeDays=365` window only reaches
 * the most recent ~109. Wide-window pull is safe — GOOGLE_CALENDAR is
 * API-backed.
 *
 * The calendar carries C2H3, BALH3, CBH3, and Sunset Seven cross-kennel
 * events; the seed routes all of them to `c2h3` (defaultKennelTag +
 * kennelCodes: ["c2h3"]), matching how the existing 109 are attributed.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-c2h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-c2h3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

backfillGCalSource({
  sourceName: "Corpus Christi H3 Calendar",
  days: 3650,
  timezone: "America/Chicago",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
