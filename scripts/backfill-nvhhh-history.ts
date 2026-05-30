/**
 * One-shot historical backfill for NVHHH (Nittany Valley H3, kennel `nvhhh`).
 * Issue #1781.
 *
 * The "Nittany Valley H3 Calendar" exposes older rows immediately before
 * HashTracks' current historical floor (Mar 16 2025 / #1881). The recurring
 * scrape's `scrapeDays: 365` window discards everything older than a year
 * every run, so events like the Dec 29 2024 #1870 "First Last Hash of the
 * Year" — and whatever the feed carries before that — never persist.
 *
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed and reconcile only
 * operates within its own window, so the older rows this writes stay stable
 * across future scrapes (see scripts/lib/gcal-backfill.ts).
 *
 * Routing: defaultKennelTag is `nvhhh` (no kennelPatterns). Timezone is
 * America/New_York (State College, PA) for the today-cutoff.
 *
 * Window: 6000 days ≈ 16.4 years — sized to capture whatever the feed holds;
 * the GCal API returns only the events that exist, so over-sizing is harmless.
 * The true archive depth is reported by the dry run.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-nvhhh-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-nvhhh-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "Nittany Valley H3 Calendar",
  days: 6000,
  timezone: "America/New_York",
});
