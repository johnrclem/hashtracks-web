/**
 * One-shot historical backfill for Capital H3 (Canberra, AU).
 *
 * Per issue #930, the Capital Hash Google Calendar enumerates 698 events
 * back to 2014-03-17, but HashTracks has only 72 because the recurring
 * scrape's 365-day window discards everything older every run. Wide-window
 * pull is safe — GOOGLE_CALENDAR is API-backed.
 *
 * Routing: defaultKennelTag is `capital-h3-au` (no kennelPatterns), so all
 * routed events flow into the single linked kennel.
 *
 * All-day events (e.g. "Public Holiday - Anzac Day", "Bike hash weekend
 * away" 3-day spans) are dropped by the GoogleCalendarAdapter unless config
 * sets `includeAllDayEvents: true` — Capital's config doesn't, so those
 * entries are filtered out automatically. Verified during dry-run.
 *
 * Window: 4500 days ≈ 12.3 years (covers 2014-03-17 earliest entry with
 * room to spare).
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-capital-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-capital-h3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

backfillGCalSource({
  sourceName: "Capital Hash Calendar",
  days: 4500,
  timezone: "Australia/Sydney",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
