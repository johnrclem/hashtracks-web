/**
 * One-shot historical backfill for Hill Country H3 (hch3) + its sister
 * full-moon kennel Heart of Texas H3 (hoth3), Killeen, TX.
 *
 * Both kennels share one public Google Calendar that retains everything back
 * to 2010. The live "Hill Country H3 Google Calendar" source only reaches 365
 * days back, so history is frozen here (2026-11-07 pull through the live
 * GoogleCalendarAdapter config — strict kennelPatterns routing, all-day
 * markers + "Miss Management"/"Pub Call" + Wako/AH3/Thursty/personal rows
 * already excluded): 1,167 events, 2010-08-07 → 2025-11-01
 * (hch3 408, hoth3 192, hoth3-humpin 567: the 2010–2021 weekly Wednesday
 * "HOTH3 Humpin Hash", split into its own kennel 2026-11-12; literal "<br>" in
 * 13 of its titles was normalized to a space).
 *
 * Seven 2010–11 HCH3 runs (Trails 290, 292, 294, 295, 297, 298, 300) are
 * titled "Hill Contry H3 …" in the calendar, so strict routing dropped them
 * from the first freeze. They were added 2026-11-13 from the same adapter with
 * a typo-tolerant `^Hill Co(?:u)?ntry\b` pattern, title typo corrected.
 * They load via scripts/backfill-hch3-hill-contry.ts. Don't re-run this
 * script in full since 2026-11-12: kennelTags are in the RawEvent
 * fingerprint, so the 567 retagged Humpin rows would be ingested again.
 *
 * Curation when freezing:
 *  - Cutoff date < 2025-11-07, strictly before the live source's 365-day
 *    window, so the two never overlap.
 *  - Same kennel+date twins (3: "Hares: TBA" placeholder duplicates) collapsed
 *    to the richest row.
 *  - runNumber removed wherever the same number repeats on more than one date
 *    (stale template carry-over: HOTH3 "#69" on 309 weekly runs 2018–2021,
 *    HCH3 "#689" ×23 in 2024–25, plus #554/#572/#573/#579) — 345 rows.
 *    Decimal / "7##" numbers ("599.9", "599.A") were never parsed.
 *  - Phone numbers / email addresses in description, hares, location redacted.
 *
 * Binds to the disabled "Hill Country H3 Calendar Archive" source
 * (upcomingOnly) so no live reconcile window ever cancels these rows.
 *
 *   Dry run:  npx tsx scripts/backfill-hch3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-hch3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/hch3-history.json";

runBackfillScript({
  sourceName: "Hill Country H3 Calendar Archive",
  kennelTimezone: "America/Chicago",
  label: "Loading frozen Hill Country H3 + Heart of Texas H3 2010-2025 calendar history",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("hch3-history.json is empty — expected 1,167 frozen events. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
