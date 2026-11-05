/**
 * One-shot historical backfill for Dayton H3 (dh3-oh, daytonhhh.org).
 *
 * The live "Dayton H3 Events Calendar" source (shared TribeEventsAdapter) is
 * forward-only (start_date defaults to today, paired with upcomingOnly
 * reconcile), so the ~500 past runs the site's Tribe calendar still exposes
 * (DH3 #1084, May 2014 → present) need a one-shot.
 *
 * Reuses TribeEventsAdapter with a past `startDate` (same field mapping as the
 * live source: hares from organizers, run number from the title), binds to the
 * live source for provenance, and routes through reportAndApplyBackfill →
 * processRawEvents. The runner keeps only date < today, so it never overlaps
 * the live source, and upcomingOnly reconcile never cancels past rows.
 *
 * NOTE: prod `dh4` still carries pre-split DH3 history (2018–2020 rows from the
 * old dh3calendar@gmail.com source, #1018) plus orphaned CANCELLED "DH3 #16xx"
 * rows. Those are NOT touched here — reattribute/clean them separately before or
 * after applying, or the same trail shows under both kennels for those years.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-dayton-h3-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-dayton-h3-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { TribeEventsAdapter } from "@/adapters/html-scraper/tribe-events-adapter";
import type { RawEventData } from "@/adapters/types";
import type { Source } from "@/generated/prisma/client";

runBackfillScript({
  sourceName: "Dayton H3 Events Calendar",
  kennelTimezone: "America/New_York",
  label: "Fetching Dayton H3 Tribe events (start_date=2000-01-01)",
  fetchEvents: async (): Promise<RawEventData[]> => {
    const source = {
      id: "backfill-dayton-h3",
      name: "Dayton H3 Events Calendar",
      type: "HTML_SCRAPER",
      url: "https://daytonhhh.org",
      config: {
        tribeEvents: true,
        kennelTag: "dh3-oh",
        startDate: "2000-01-01",
        maxEvents: 2000,
        haresFromOrganizers: true,
        runNumberFromTitle: true,
      },
    } as unknown as Source;
    const res = await new TribeEventsAdapter().fetch(source, { days: 9999 });
    // Fail loud on ANY error — fetch failure, maxEvents truncation or skipped
    // rows all mean an incomplete archive slice.
    if (res.errors.length > 0) {
      throw new Error(`TribeEventsAdapter failed: ${res.errors.join("; ")}`);
    }
    return res.events;
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
