/**
 * One-shot historical backfill for O2H3 (Other Orlando H3, kennel `o2h3`).
 *
 * The "O2H3 Google Calendar" (hashcalendar@gmail.com) backs a kennel founded
 * in 1986 with run numbers already past #2347, so a deep archive may exist
 * behind the recurring scrape's `scrapeDays: 365` window. The dry run reports
 * the true depth; if the feed only holds a year or two, this script recovers
 * whatever exists (the GCal API returns only real events, so over-sizing the
 * window is harmless).
 *
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed and reconcile only
 * operates within its own window, so the older rows this writes stay stable
 * across future scrapes (see scripts/lib/gcal-backfill.ts).
 *
 * PARSER + CONFIG DEPENDENCY (#1796): O2H3 packs the run number and a literal
 * "Title:" label into the summary ("O2H3 #: 2340 Title: ...", "O2H3# 2336").
 * Correct extraction needs BOTH:
 *   1. the rebased adapter — shared extractHashRunNumber now parses the `#:`
 *      colon form (utils.ts gap widened to `[\s:]*`), AND
 *   2. the O2H3 `titleStripPatterns` in Source.config, which the backfill
 *      adapter reads from the PROD DB — so `npx prisma db seed` must have run
 *      in prod before applying, or display titles keep the `#: NNNN Title:`
 *      noise (run numbers extract regardless; only the title strip needs it).
 * Backfilling against a stale adapter/config bakes durable, unrepairable
 * historical rows that a later fix can't reach outside the scrape window —
 * verify the dry-run samples show clean titles + numeric run numbers first.
 *
 * Window: 7500 days ≈ 20.5 years.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-o2h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-o2h3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "O2H3 Google Calendar",
  days: 7500,
  timezone: "America/New_York",
});
