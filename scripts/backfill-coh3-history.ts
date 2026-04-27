/**
 * One-shot historical backfill for COH3 (Central Oregon). Issue #980.
 *
 * Source "Central Oregon H3 Calendar" exposes 69 VEVENTs spanning
 * 2021-03-27 → 2026-09-11, but only 11 (runs #114–#125, all April 2025+)
 * have been ingested. Backfilling fixes the misleading "1 YEAR ACTIVE"
 * stat — kennel has been running since 2021. Wide-window pull is safe
 * — GOOGLE_CALENDAR is API-backed.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-coh3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-coh3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

backfillGCalSource({
  sourceName: "Central Oregon H3 Calendar",
  days: 3650,
  timezone: "America/Los_Angeles",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
