/**
 * One-shot historical backfill for NOH3 (New Orleans H3). Issue #1773.
 *
 * The "NOH3 Google Calendar" (nolahash@gmail.com) enumerates ~2,067 events
 * back to 2006-09-05 ("MissManagement Meeting"), but the recurring scrape's
 * 365-day window leaves HashTracks with only ~941 tracked rows (oldest loaded
 * 2018-01-12) — ~1,126 historical rows short. Wide-window pull is safe —
 * GOOGLE_CALENDAR is API-backed and reconcile only operates within its own
 * window, so older rows stay stable across future scrapes.
 *
 * Routing: defaultKennelTag is `noh3` (no kennelPatterns); `includeAllDayEvents`
 * is true (NOH3 publishes runs as all-day rows with the time in the body).
 *
 * Hares + start time: the source config now carries NOH3 prose `harePatterns`
 * (#1774) and the adapter promotes the "go" time from the description (#1775),
 * so the backfilled rows pick up both — but ONLY after `npx prisma db seed`
 * lands the updated Source.config. Run the seed first, then this backfill.
 *
 * Window: 7500 days ≈ 20.5 years (covers the 2006-09-05 earliest entry).
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-noh3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-noh3-history.ts
 *   Env:     GOOGLE_CALENDAR_API_KEY, DATABASE_URL
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "NOH3 Google Calendar",
  days: 7500,
  timezone: "America/Chicago",
});
