/**
 * One-shot historical backfill for OC Hump (kennel `ochump`). Issue #1809.
 *
 * The "OC Hump Google Calendar" enumerates a deep archive — the public feed
 * carries 142 VEVENT entries spanning 2011-12-25 through 2026-07-22 — but the
 * recurring scrape's `scrapeDays: 90` window discards everything older than ~3
 * months every run, leaving HashTracks with only ~40 tracked events.
 *
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed and reconcile only
 * operates within its own window, so the older rows this writes stay stable
 * across future scrapes (see scripts/lib/gcal-backfill.ts).
 *
 * Routing: defaultKennelTag is `ochump` (no kennelPatterns). Timezone is
 * America/Los_Angeles (Orange County, CA) for the today-cutoff.
 *
 * Window: 6000 days ≈ 16.4 years — comfortably covers the 2011-12-25 floor.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-oc-hump-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-oc-hump-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "OC Hump Google Calendar",
  days: 6000,
  timezone: "America/Los_Angeles",
});
