/**
 * One-shot historical backfill for Malvern H3 (malvern-h3).
 *
 * The live source is a rolling forward iCal feed (hash-cal.ics, ~5 weeks), so
 * the kennel's archive never reaches canonical Events from the scrape. Frozen
 * from malvernhash.co.uk/hashes/?year=2003…2026 (one table per year: run #,
 * date, venue, hares, notes): 1,190 weekly Tuesday runs, #902 (7 Jan 2003) →
 * #2093 (20 Oct 2026). Rows from 27 Oct 2026 onward are left to the live feed.
 *
 * Cleanup applied when freezing: "Venue TBC" → no location (29 rows), the
 * "Hash Holiday" 25 Dec 2007 placeholder dropped, a TBC hare dropped, and the
 * archive's "#1814 · 25 Apr 2023" typo corrected to #1914 (its neighbours are
 * #1913 18 Apr and #1915 2 May 2023). The archive has no times or coordinates,
 * so startTime is omitted and the merge pipeline geocodes the venue text.
 * Notes (themes like "XMAS BASH", "AGM") go to description; title is left to
 * merge ("Malvern H3 Trail #N").
 * Binds to the "Malvern H3 iCal Feed" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-malvern-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-malvern-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/malvern-h3-history.json";

runBackfillScript({
  sourceName: "Malvern H3 iCal Feed",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Malvern H3 (malvern-h3) /hashes/?year= archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("malvern-h3-history.json is empty — expected ~1,190 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
