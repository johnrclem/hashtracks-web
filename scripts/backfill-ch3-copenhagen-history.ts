/**
 * One-shot historical backfill for CH3 Copenhagen (and co-routed CH4 / RDH3).
 *
 * Per issue #933, the Copenhagen H3 Google Calendar holds 1367 VEVENTs going
 * back to 2012-05-07 (CH3 #1892), but HashTracks has only 78 CH3 events
 * because the recurring scrape's window discards everything older than 365
 * days every run. Wide-window pull is safe — GOOGLE_CALENDAR is API-backed
 * and the adapter enumerates whatever window it's asked for.
 *
 * Routing: source.config.kennelPatterns at sources.ts:2740 already routes
 * CH3 → ch3-dk, CH4 → ch4-dk, RDH3 → rdh3. All three kennels are linked
 * via SourceKennel, so the historical backfill restores all of them in one
 * pass.
 *
 * Window: 5500 days ≈ 15 years (well beyond the 2012 earliest entry).
 * Symmetric forward window of 5500 days is harmless — GCal returns no events
 * past timeMax, so an oversized future window doesn't cost anything.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-ch3-copenhagen-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-ch3-copenhagen-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

backfillGCalSource({
  sourceName: "Copenhagen H3 Google Calendar",
  days: 5500,
  timezone: "Europe/Copenhagen",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
