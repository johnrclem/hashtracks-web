/**
 * CROSS-KENNEL HISTORICAL BACKFILL — Leap Year H3 (Seattle) + 12 WA siblings.
 * Issue #1601.
 *
 * ⚠️  This script writes historical events for ALL 13 kennels on the WA
 *     Hash Google Calendar — not just leapyear-h3 — by design. The
 *     wide-window scrape returns one stream that the merge pipeline routes
 *     via the calendar's `kennelPatterns` config. Codex review flagged the
 *     misleading filename; keeping it because:
 *
 *       (a) The #1601 issue body explicitly calls the sibling backfill an
 *           "audit bonus" — the only Leap Year H3 events themselves are 3
 *           total (#6, #7, #8); the headline yield is the 12-sibling
 *           historical refresh.
 *       (b) Seed comment at prisma/seed-data/sources.ts:2367 documents the
 *           same intent.
 *       (c) Filtering down to leapyear-h3 only would discard the audit
 *           bonus the issue specifically commissioned.
 *
 *     If you need a leapyear-h3-ONLY pass (e.g. for re-running with a
 *     different filter), fork this script and post-filter `result.events`
 *     down to `kennelTags[0] === "leapyear-h3"` before delegating to merge.
 *
 * Drives the WA Hash Google Calendar with a 7500-day window (~20.5yr) to
 * recover the three historical Leap Year events HashTracks was missing:
 *
 *   - #6 (2008-02-29) — NOT recovered: calendar owner cleaned it
 *   - #7 (2012-02-29) ✓ landed
 *   - #8 (2016-02-29) ✓ landed
 *
 * These sit in the Whoreman-format WA Hash Calendar (the primary aggregator
 * for 13 WA kennels), and reach the LeapYear kennel via `kennelPatterns`
 * routing in the seed. The seeded `scrapeDays: 1500` (post-#1601) only
 * reaches Feb 2022, so we override to 7500 here to span back to ~2005.
 *
 * Sibling backfills: per-kennel tally printed by the helper. The same pass
 * recovers historical context for the other 12 WA kennels (sh3-wa, psh3,
 * nbh3-wa, rch3-wa, seamon-h3, th3-wa, ssh3-wa, cunth3-wa, taint-h3,
 * giggity-h3, seh3-wa, hswtf-h3) — explicitly called out as an audit bonus
 * in the seed comment at prisma/seed-data/sources.ts:2367.
 *
 * Explicitly out of scope (deferred):
 *   The 2 future placeholders #15 (2044-02-29) / #16 (2048-02-29) live on
 *   the Leap Year H3 Hareline Sheet (GOOGLE_SHEETS) source, not on this
 *   calendar. Bumping the sheet's scrapeDays past 22yr would surface every
 *   interstitial "??" placeholder row through 2048 as canonical data
 *   (Codex pushback, reverted in commit e0a61808). See seed comment at
 *   prisma/seed-data/sources.ts:2472-2477 for the rationale.
 *
 * Idempotent: `processRawEvents` dedupes by (sourceId, fingerprint).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-leap-year-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-leap-year-history.ts
 *   Env:       DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */

import "dotenv/config";
import { runGCalBackfill } from "./lib/gcal-backfill";

runGCalBackfill({
  sourceName: "WA Hash Google Calendar",
  // 7500 days ≈ 20.5 yr — spans back to ~2005-12, comfortably reaching
  // Leap Year #6 (2008-02-29) and #7 (2012-02-29). 4500 / 6500 attempts
  // landed only #7+; the calendar owner retains events to at least 2008.
  // The Google Calendar API tolerates the deeper window — the calendar
  // returns whatever it has (the owner controls retention).
  days: 7500,
  timezone: "America/Los_Angeles",
});
