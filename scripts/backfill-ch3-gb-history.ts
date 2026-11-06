/**
 * One-shot historical backfill for Chichester H3 (ch3-gb).
 *
 * The live source is the club's rolling diary .ics (Run 1025, Jan 2024 →
 * present), so the archive back to Est 1983 never reaches canonical Events
 * from the scrape. Frozen from chihhh.org.uk/runstodate.php (run #, date,
 * OS grid ref, venue, hares): 1,047 runs, #1 (11 Sep 1983) → #1024
 * (17 Dec 2023). Rows from 7 Jan 2024 onward are left to the live feed.
 *
 * Coordinates are the OS Landranger grid ref converted OSGB36 → WGS84 (checked
 * against the live feed's GEO pins for 2024 runs: 21–102 m apart, i.e. within
 * the 100 m grid square). Rows without a grid ref (venue "TBA", the Euro/France
 * weekends) carry no location or coords.
 *
 * Cleanup applied when freezing:
 *   - "NO HASH" rows dropped (2); an exact duplicate row for #675 dropped.
 *   - Low-numbered special sub-series (walks, socials re-using #1–#6 after 1984)
 *     keep no runNumber (14 rows). Where the archive gives one main-series
 *     number to two rows (weekends away, socials), the Sunday / earlier row
 *     keeps it and the other is unnumbered (11 rows).
 *   - #238 "1992-01-03" → 1993-01-03 (between #237 20 Dec 1992 and #239
 *     17 Jan 1993; 3 Jan 1993 is a Sunday).
 *   - #150: venue text spilled into the hares cell ("FarmAndrew & …") →
 *     venue "Adsdean Farm", hares "Andrew & …".
 *   - The archive's "&" for "And" inside names (&rew, &erson, &y) restored.
 *   - Hares are taken from the hares cell only when it reads as a plain hare
 *     list (same rule as the live adapter's gridRefPreambleHares); the full
 *     cell text otherwise goes to description.
 * Binds to the "Chichester H3 iCal Feed" source (upcomingOnly:true).
 *
 *   Dry run:  npx tsx scripts/backfill-ch3-gb-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-ch3-gb-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/ch3-gb-history.json";

runBackfillScript({
  sourceName: "Chichester H3 iCal Feed",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Chichester H3 (ch3-gb) runstodate.php archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("ch3-gb-history.json is empty — expected ~1,047 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
