/**
 * One-shot historical backfill for two SFH3 MultiHash kennels whose deep run
 * archives sit on sfh3.com but never reach HashTracks from the recurring scrape:
 *
 *   - SFFMH3 (Fully Mooned H3, sfh3 id 7) — ~100 full-moon crawls 2008→2026 (#2296)
 *   - SVH3   (Silicon Valley H3, sfh3 id 5) — ~430 numbered runs 2002→2026 (#2366)
 *
 * Thin wrapper over the reusable `backfillSfh3Kennel` helper (scripts/lib/
 * sfh3-backfill.ts), which fetches each `?kennel=<id>&period=<bucket>` page,
 * asserts the kennel filter was honored (`expectedLabel` guard — prevents
 * importing another kennel's history under our code), maps rows with the
 * adapter's parsers (incl. `startTime` via parse12HourTime), enriches
 * descriptions from detail pages, and routes `date < today` through merge.
 *
 * The helper's default period buckets are stale (sfh3.com now exposes one option
 * per year), so we pass the current per-year list. SFFMH3 has only ~100 crawls
 * total and the page returns the full list for any single year, so one bucket
 * suffices there; SVH3's archive spans buckets, so we sweep every year + dedup
 * (the helper de-dupes by fingerprint across buckets).
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-sfh3-archive-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-sfh3-archive-history.ts
 */

import { backfillSfh3Kennel } from "./lib/sfh3-backfill";

// Current sfh3.com/runs period <option> values (one per year + the early bucket).
const SVH3_PERIODS = [
  "1990-2001", "2002", "2003", "2004", "2005", "2006", "2007", "2008", "2009",
  "2010", "2011", "2012", "2013", "2014", "2015", "2016", "2017", "2018", "2019",
  "2020", "2021", "2022", "2023", "2024", "2025", "2026",
] as const;

async function main(): Promise<void> {
  // SFFMH3 — id 7. period is ignored for this kennel (any single year returns
  // the whole ~100-crawl list), but a value must be present.
  await backfillSfh3Kennel({
    sfh3KennelId: 7,
    kennelCode: "sffmh3",
    sourceName: "SFH3 MultiHash HTML Hareline",
    periods: ["2026"],
    expectedLabel: "FMH3",
  });

  // SVH3 — id 5. Sweep every year bucket; the helper de-dupes across overlaps.
  await backfillSfh3Kennel({
    sfh3KennelId: 5,
    kennelCode: "svh3",
    sourceName: "SFH3 MultiHash HTML Hareline",
    periods: SVH3_PERIODS,
    expectedLabel: "SVH3",
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
