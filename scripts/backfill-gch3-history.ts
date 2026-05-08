/**
 * One-shot historical backfill for Gulf Coast H3 (Mobile, AL). Issue #1255.
 *
 * The "Gulf Coast H3 Google Calendar" enumerates ~75 events 2024-01-01 →
 * 2027-01-01, but the recurring scrape's window leaves HashTracks with only
 * 32 (1 upcoming + 31 past) — ~43 missing including 8 confirmed future runs.
 * Wide-window pull is safe — GOOGLE_CALENDAR is API-backed, reconcile only
 * operates within its own window so older rows stay stable.
 *
 * Routing: defaultKennelTag is `gch3` (no kennelPatterns).
 *
 * NOTE: must be applied AFTER WS1's GoogleCalendarAdapter fixes merge
 * (#1271/#1272/#1274/#1275), otherwise mis-parsed run numbers and any
 * personal-event false positives become durable RawEvent rows that WS1's
 * later parser fix cannot retroactively repair.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-gch3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-gch3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "Gulf Coast H3 Google Calendar",
  days: 1500,
  timezone: "America/Chicago",
});
