/**
 * One-shot historical backfill for Newcastle H3 (newcastle-h3) — hareline-sheet archive.
 *
 * The kennel's public hareline Google Sheet (hareline.nhhh.co.uk) carries a ten-year
 * archive (2014 → 2025, 666 numbered runs) on 12 per-year tabs whose layouts and date
 * formats differ (M/D/YY on 2015–2020, D/M/YYYY from 2021, day+month-name on 2014), so
 * the live GOOGLE_SHEETS source only reads the current-year tab. This loader replays a
 * frozen extract of the archive through the merge pipeline, bound to the
 * "Newcastle H3 Hareline Sheet" source (upcomingOnly:true → never reconciled/cancelled).
 *
 * Frozen JSON: run number, date, hares (joined + sorted), venue, street, notes.
 * No start times (the sheet has none). Phone/email scrubbed. Fixes applied from each
 * row's own Day cell (#1328, #1640, #1628 year/format typos; #1443, #1469, #1474,
 * #1590, #1714, #1715 one-day slips). Undated rows (#1200, #1251), the cancelled #1609
 * and unnumbered non-run rows are dropped. Runs #1253–#1317 (2015) are not in the sheet.
 *
 * Strict date partition: this loader covers < 2026-01-04; the live adapter covers 2026+.
 *
 *   Dry run:  npx tsx scripts/backfill-newcastle-h3-sheet-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-newcastle-h3-sheet-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/newcastle-h3-sheet-history.json";

const LIVE_ADAPTER_START = "2026-01-04";

runBackfillScript({
  sourceName: "Newcastle H3 Hareline Sheet",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Newcastle H3 (newcastle-h3) hareline-sheet archive",
  fetchEvents: async () => {
    const events = (history as RawEventData[]).filter((e) => e.date < LIVE_ADAPTER_START);
    if (events.length < 600) {
      throw new Error(
        `newcastle-h3-sheet-history.json has ${events.length} pre-${LIVE_ADAPTER_START} rows — expected ~666. Aborting.`,
      );
    }
    return events;
  },
}).catch((err) => { console.error(err); process.exitCode = 1; });
