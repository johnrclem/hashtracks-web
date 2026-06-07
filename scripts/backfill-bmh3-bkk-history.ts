/**
 * One-shot historical backfill for Bangkok Monday H3 (bmh3-bkk).
 *
 * bangkokmondayhhh.com publishes a clean per-year run archive (Index2002.html …
 * Index2026.html, ~1,185 runs #981→#2212). The recurring adapter only reads the
 * forward hareline + homepage (config.upcomingOnly), so the 2002→2026 archive
 * would never reach canonical Events.
 *
 * The archive was extracted once (throwaway walker over the year indexes, reusing
 * the adapter's row parser) and frozen into `scripts/data/bmh3-bkk-history.json`.
 * This loader just replays that curated dataset through the merge pipeline; rows
 * bind to the "Bangkok Monday H3 Hareline" source for provenance.
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row, and
 * partitions to strictly-past rows (date < today in Asia/Bangkok).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-bmh3-bkk-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bmh3-bkk-history.ts
 *
 * Requires the "Bangkok Monday H3 Hareline" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import { buildRunHareTitle } from "@/adapters/utils";
import bmh3History from "./data/bmh3-bkk-history.json";

const SOURCE_NAME = "Bangkok Monday H3 Hareline";
const KENNEL_TIMEZONE = "Asia/Bangkok";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated bangkokmondayhhh.com run archive (2002→2026)",
  // The frozen archive predates the source-faithful title (#2016) and carries no
  // `title`. Reconstruct it here from the same runNumber + hares the live
  // adapter uses (`buildRunHareTitle`) so a re-run re-fingerprints each row and
  // the merge pipeline UPDATEs the canonical title in place — replacing the
  // historical "Bangkok Monday H3 Trail #N" placeholders.
  fetchEvents: async () =>
    (bmh3History as RawEventData[]).map((r) => ({
      ...r,
      title: buildRunHareTitle(r.runNumber ?? undefined, r.hares),
    })),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
