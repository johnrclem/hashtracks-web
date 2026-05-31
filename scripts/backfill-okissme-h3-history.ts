/**
 * One-shot historical backfill for OKissMe H3 (Orlando/Kissimmee, FL).
 * Issue #1845.
 *
 * The OKissMe H3 Hareline Google Sheet
 *   https://docs.google.com/spreadsheets/d/1MMS96JayUN3TBITvmLyc-TQH9RvjzcHcPwjn2cGHoVs
 * carries every run back to the inaugural #1 (2022-05-14). The recurring
 * GOOGLE_SHEETS adapter only ingests rows inside its ±days window, so runs
 * #1–#37 (2022-05-14 → 2025-02-09) never landed on HashTracks (26 events
 * present, runs #38–#61).
 *
 * **Strategy:** reuse the live `GoogleSheetsAdapter` with the DB source's own
 * config and a very wide window (`days: 3000` ≈ 8 years) so the parse — and
 * therefore every RawEvent fingerprint — is byte-identical to the recurring
 * adapter's. `reportAndApplyBackfill` then partitions to `date < today
 * (America/New_York)` so only the historical slice is inserted; the recurring
 * adapter keeps owning the upcoming window. Fingerprint dedup in
 * `processRawEvents` makes re-runs (and the overlap with already-ingested
 * 2025 rows) a no-op.
 *
 * **Provenance:** attributed to the "OKissMe H3 Hareline" source (the same row
 * the recurring scrape uses), so the per-event source-kennel guard accepts the
 * rows and reconcile never touches them (historical, far outside the live
 * window).
 *
 * **Field notes:** the sheet's Time column is repurposed as an attendance
 * count on past rows — it is NOT mapped, so Sunday rows default to 11:00 via
 * the source's `startTimeRules`. Empty-Theme rows get the merge-synthesized
 * default title.
 *
 * Usage:
 *   Dry run:  set -a && source .env && set +a && npx tsx scripts/backfill-okissme-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-okissme-h3-history.ts
 *   Env:      DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { prisma } from "@/lib/db";
import { GoogleSheetsAdapter } from "@/adapters/google-sheets/adapter";
import type { RawEventData } from "@/adapters/types";
import type { Source } from "@/generated/prisma/client";

const SOURCE_NAME = "OKissMe H3 Hareline";
const KENNEL_TIMEZONE = "America/New_York";
const WIDE_WINDOW_DAYS = 3000;

async function fetchEvents(): Promise<RawEventData[]> {
  const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
  if (!source) {
    throw new Error(`Source "${SOURCE_NAME}" not found. Run \`npx prisma db seed\` first.`);
  }
  console.warn(`Replaying GoogleSheetsAdapter over "${SOURCE_NAME}" (days=${WIDE_WINDOW_DAYS})`);

  const result = await new GoogleSheetsAdapter().fetch(source as Source, {
    days: WIDE_WINDOW_DAYS,
  });
  if (result.errors.length > 0) {
    console.warn(`  adapter reported ${result.errors.length} error(s): ${result.errors.join("; ")}`);
  }
  console.warn(`  Rows parsed across the full window: ${result.events.length}`);
  return result.events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Replaying OKissMe H3 Hareline sheet across the full date range",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
