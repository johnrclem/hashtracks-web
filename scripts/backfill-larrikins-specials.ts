/**
 * One-shot historical backfill for Sydney Larrikins special events (#2391).
 *
 * The live "Sydney Larrikins Special Events" source (TRIBE_EVENTS via the shared
 * TribeEventsAdapter) reads the kennel's "The Events Calendar" install with
 * start_date defaulting to today — so it only ever ingests UPCOMING specials
 * (paired with upcomingOnly reconcile). The 6 special / milestone events the
 * kennel has already run this year (Larrikin Long Lunch, two Friday-the-13th
 * runs, Noosa 50th, AGPU, milestone #2500 — Feb–Jun 2026) are already in the
 * past, so they need a one-shot.
 *
 * Reuses TribeEventsAdapter with a past `startDate` (same mapping as the live
 * source), binds to the "Sydney Larrikins Special Events" source for correct
 * provenance, and routes through reportAndApplyBackfill → processRawEvents
 * (canonical Events in one pass; idempotent; strict date<today partition so it
 * never collides with the live upcoming source, which owns dates >= today).
 *
 * The weekly numbered-trail back-catalog (#1–#2501) is NOT enumerable anywhere
 * on the site — only these special events are.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-larrikins-specials.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-larrikins-specials.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { TribeEventsAdapter } from "@/adapters/html-scraper/tribe-events-adapter";
import type { RawEventData } from "@/adapters/types";
import type { Source } from "@/generated/prisma/client";

runBackfillScript({
  sourceName: "Sydney Larrikins Special Events",
  kennelTimezone: "Australia/Sydney",
  label: "Fetching Sydney Larrikins Tribe special events (start_date=2026-01-01)",
  fetchEvents: async (): Promise<RawEventData[]> => {
    const source = {
      id: "backfill-larrikins-specials",
      name: "Sydney Larrikins Special Events",
      type: "HTML_SCRAPER",
      url: "https://sydney.larrikins.org",
      config: { tribeEvents: true, kennelTag: "larrikins-au", startDate: "2026-01-01" },
    } as unknown as Source;
    const res = await new TribeEventsAdapter().fetch(source, { days: 9999 });
    // Fail loud on a fetch/parse failure (errorDetails.fetch is the fatal path;
    // the benign skippedCount soft-signal in res.errors is not fatal) — abort
    // rather than backfilling an empty/partial slice as if it were complete.
    if (res.errorDetails?.fetch?.length) {
      throw new Error(`TribeEventsAdapter failed: ${res.errors.join("; ")}`);
    }
    return res.events; // runner keeps only date < today (drops the future City 2 Surf)
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
