/**
 * One-shot historical backfill for White House H3 (wh4), issue #2481.
 *
 * The live "White House H3 Hareline" GOOGLE_SHEETS source reads the sheet's
 * "Upcoming Trails" tab (gid=163010917 = the 2026 season). The same published
 * sheet has a separate historical tab (gid=377767908) with ~297 older runs
 * (2016–2023, run# 1717–2101, gappy — no 2021, and 2024–25 absent). Those
 * pre-2026 runs are on a tab the live source never reads, so they need a one-shot.
 *
 * Reuses GoogleSheetsAdapter for parsing (same column layout as the live tab),
 * binds to the "White House H3 Hareline" source for correct provenance, and
 * routes through reportAndApplyBackfill → processRawEvents (canonical Events
 * created in one pass; idempotent; strict date<today partition so it never
 * collides with the live 2026 source).
 *
 * The deeper archive (1987→2016, run #1–#1716) + the 2024–25 gap are not on the
 * sheet — recoverable only from the kennel's own records (cf. #2053).
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-wh4-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-wh4-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { GoogleSheetsAdapter } from "@/adapters/google-sheets/adapter";
import type { RawEventData } from "@/adapters/types";
import type { Source } from "@/generated/prisma/client";

const SHEET =
  "2PACX-1vSydTV1S3AL9iUCrZKfzd7r9PCXSjx8wep3GWwuRAaA4THOpHrSgP-VGb87ICMWPe3iFM9WdNIyGh4K";
const HISTORICAL_CSV = `https://docs.google.com/spreadsheets/d/e/${SHEET}/pub?gid=377767908&single=true&output=csv`;

runBackfillScript({
  sourceName: "White House H3 Hareline",
  kennelTimezone: "America/New_York",
  label: "Fetching WH4 historical hareline tab (gid=377767908)",
  fetchEvents: async (): Promise<RawEventData[]> => {
    const source = {
      id: "backfill-wh4-hist",
      name: "White House H3 Hareline",
      type: "GOOGLE_SHEETS",
      url: "https://whitehousehash.com/hareline",
      config: {
        sheetId: "anonymous",
        csvUrl: HISTORICAL_CSV,
        columns: { runNumber: 0, date: 1, title: 2, location: 3, hares: 4 },
        kennelTagRules: { default: "wh4" },
      },
    } as unknown as Source;
    const res = await new GoogleSheetsAdapter().fetch(source, { days: 9999 });
    // Fail loud: a fetch/parse failure returns errors alongside a partial or
    // empty event set — abort rather than silently backfilling an incomplete
    // slice as if it were the whole archive.
    if (res.errors.length > 0) {
      throw new Error(`GoogleSheetsAdapter failed: ${res.errors.join("; ")}`);
    }
    return res.events;
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
