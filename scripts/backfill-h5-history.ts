/**
 * One-shot historical backfill for H5 (Honolulu H5, kennel `h5-hi`). Issue #1247.
 *
 * Two Google Calendars contribute H5 events:
 *   1. "Honolulu H5 Google Calendar" — defaultKennelTag `h5-hi` (primary, ~172 events 2024–2026)
 *   2. "Aloha H3 Google Calendar"    — kennelPatterns route `H5`/`Honolulu H[45]` → `h5-hi` (~62 partial-overlap entries)
 *
 * The recurring scrape's `scrapeDays: 365` discards everything older every run,
 * which is why HashTracks has 1 upcoming + 66 past vs. ~172 source events.
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed and reconcile only
 * operates within its own window.
 *
 * Each calendar has its own Source.id → independent RawEvent fingerprint
 * namespace. The merge pipeline collapses two raw rows for the same
 * `(kennelId, date)` into one canonical Event, so pulling both is correct
 * and dedupes cleanly. Trust-level wins for conflicting fields.
 *
 * NOTE: must be applied AFTER WS1's GoogleCalendarAdapter fixes merge
 * (#1271/#1272/#1274/#1275). The Aloha calendar in particular feeds three
 * kennels (AH3, H5, PHH) — any mis-parsed run number or personal-event
 * false positive becomes a durable RawEvent row that a later parser fix
 * cannot retroactively repair.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-h5-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-h5-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { backfillGCalSource } from "./lib/gcal-backfill";

const TIMEZONE = "Pacific/Honolulu";
// 4000 days ≈ 11 yr — comfortably covers the 2024 archive floor and any
// pre-2024 runs we've never seen.
const DAYS = 4000;

async function main(): Promise<void> {
  console.log("===== Source 1/2: Honolulu H5 Google Calendar =====\n");
  await backfillGCalSource({
    sourceName: "Honolulu H5 Google Calendar",
    days: DAYS,
    timezone: TIMEZONE,
  });

  console.log("\n===== Source 2/2: Aloha H3 Google Calendar (H5 events via kennelPatterns) =====\n");
  await backfillGCalSource({
    sourceName: "Aloha H3 Google Calendar",
    days: DAYS,
    timezone: TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
