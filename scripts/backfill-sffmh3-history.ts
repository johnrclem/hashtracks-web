/**
 * One-shot historical backfill for SFFMH3 (San Francisco Full Moon Hash) — #2260.
 *
 * The SFH3 multihash platform maps kennel code FMH3 ("Fully Mooned H3 Crawls") to
 * HashTracks' sffmh3. The live sources (SFH3 MultiHash iCal Feed / HTML Hareline)
 * only return the upcoming window at /runs?kennels=all, so widening either is
 * unsafe (partial-enumeration — reconcile would cancel rows the adapter doesn't
 * re-emit). This backfill does NOT touch either live source or their adapters.
 *
 * Source: https://www.sfh3.com/runs?kennel=7&kennels=7&period=all (FMH3 = kennel
 * index 7 in the site's dropdown). NOTE: this does NOT reuse the shared
 * `scripts/lib/sfh3-backfill.ts` period-bucket helper (used by Agnews/EBH3/etc) —
 * verified live 2026-08-12 that the `period` query param is a no-op for this
 * kennel (period=2025-2026 and period=2009-2016 both returned the byte-identical
 * 100-row table as period=all), so there is no bucket to page through. The page's
 * own caption ("Showing all 100 runs in 2008–2026") confirms 100 rows is the
 * actual ceiling, not a display truncation — no further history is reachable
 * from this endpoint.
 *
 * Parsed once from the live table and frozen into `scripts/data/sffmh3-history.json`
 * (no live parser committed — throwaway extractor, not committed, per the
 * H7/Asunción pattern). 99 of the table's 100 rows survive: one row was a
 * same-date "FMH3" placeholder-title husk (no hare/location/anything else) that
 * duplicated a richer row for the same date — dropped as a split-row artifact,
 * not a real second trail (mirrors the "title fallback must never be a
 * placeholder" pitfall). The 1 already-tracked event (Flower Moon Pub Crawl,
 * 2026-05-08) stays in the frozen set; the merge pipeline dedupes it against the
 * existing iCal-sourced canonical event by kennel+date rather than duplicating it.
 *
 * Field availability matches the issue's own count: title ~56/99, hares ~29/99
 * (rest "Unknown" in the source, dropped), location ~54/99, runNumber only 1/99
 * (source numbers almost nothing — "(No #)" on all but one row). `startTime` and
 * `cost` are not in this table at all and are omitted (undefined, not null —
 * these fields were never observed, not explicitly cleared).
 *
 * Binds to a dedicated archive source, NOT the live "SFH3 MultiHash..." sources
 * (both scrapeDays=90-ish upcoming-window sources with no upcomingOnly flag —
 * binding there risks the archive pitfall). WS1 needs to add a disabled,
 * upcomingOnly:true archive row: "SFFMH3 Runs Archive" (kennelCodes: ["sffmh3"])
 * — see the PR body handoff.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-sffmh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sffmh3-history.ts
 *
 * Requires the "SFFMH3 Runs Archive" source to exist first (WS1 handoff).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sffmh3-history.json";

const SOURCE_NAME = "SFFMH3 Runs Archive";
const KENNEL_TIMEZONE = "America/Los_Angeles";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen SFFMH3 (sffmh3) sfh3.com FMH3 runs archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sffmh3-history.json is empty — expected ~99 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
