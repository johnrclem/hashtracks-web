/**
 * One-shot historical backfill for Sierra H4 (sierra-h4, Freetown) — HC
 * batch-11, config-only. First Sierra Leone kennel, first West Africa, 2nd
 * African country after Kenya.
 *
 * The Harrier Central adapter is future-only, so Sierra H4's past runs (53
 * counted rows, #15 2024-08-21 → #130 2026-06-03) would never reach canonical
 * Events from the live scrape. 0 upcoming at build (documented annual rainy-
 * season pause, ~May–August; the 2025 season shows an identical ~84-day gap
 * #64→#79) — still 0 upcoming as of this build, ~10 weeks past the last run,
 * longer than the handoff's own ~August-resumption estimate. Onboarding
 * anyway per the handoff's evidence (active club site hosting Pan Africa
 * Hash 2027, 53-run pre-pause cadence); the live scrape picks up the next run
 * the moment SH4 posts it. Frozen from hashruns.org/api/global-runs?isFuture=0,
 * filtered to PublicKennelId 8f01a559-5c86-46de-8efa-18722dd7b7d0.
 *
 * Scrubs applied when freezing:
 *  - Sierra Leone bbox (lat 6.9–10.0 / lng -13.4…-10.2) — 36 of 53 rows carry
 *    coords; the rest lack lat/lng in the source feed (omitted, not zeroed).
 *  - PII scrub (emails, phone-like sequences) on `description` — the raw feed
 *    carries no verbatim phone/email strings, but the regex ran regardless.
 *  - Placeholder locations ("TBC", "To Be Accounced") → undefined.
 *  - 🔴 Per-row hare/location bleed: dropped `hares` only where it exactly
 *    equals that row's `location` string (2026-05-20 "Zizobala Spot…" and
 *    2026-06-03 "Bondu's WhatsApp") — NOT a blanket ban on those venue names,
 *    which recur legitimately as real venues on other dates (e.g. "Bondu's
 *    Whatsapp Bar" on 2024-12-04 and 2025-05-07, where `hares` is a normal
 *    hare-crew name, not a location echo).
 *  - `cost` composed from EventPriceForMembers/NonMembers as "NLe M/NM" (or
 *    "NLe M" when member/non-member prices match, "Free" when both are 0).
 *  - 🔴 EventNumber kept FAITHFULLY, never renumbered, even where visibly
 *    non-monotonic or duplicated across dates (#48 and #49 each appear twice
 *    on different dates in the raw feed) — same Douliu-precedent policy as
 *    the ph3-cz/Prague backfill in this batch.
 *
 * Binds to "Sierra H4 Harrier Central" (upcomingOnly:true → reconcile never
 * cancels these; the multi-month seasonal gap is expected, not staleness).
 *
 *   Dry run:  npx tsx scripts/backfill-sierra-h4-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sierra-h4-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sierra-h4-history.json";

runBackfillScript({
  sourceName: "Sierra H4 Harrier Central",
  kennelTimezone: "Africa/Freetown",
  label: "Loading frozen Sierra H4 (sierra-h4) Harrier Central archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sierra-h4-history.json is empty — expected ~53 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
