/**
 * One-shot historical backfill for HAH3 (Half-Assed Hash, San Diego).
 * Issue #1314.
 *
 * `https://sdh3.com/history.shtml` lists every San Diego–area hash since 2007.
 * Filtering for `(Half-Assed)` gives ~186 events; HashTracks tracked only 13
 * before this backfill (earliest 2025-06-14) because the live SDH3 source
 * uses a 90-day reconcile window and the back catalog can never enter via
 * a wider hareline scrape (#1314 walks through this in detail).
 *
 * Strategy: delegated to `backfillSdh3HistoryKennel` (scripts/lib/sdh3-history-backfill.ts).
 * The shared helper handles fetch, parse, partition, and merge-pipeline routing.
 *
 * Why attribute to "SDH3 Hareline":
 *   That source already has the 10-kennel SourceKennel link including
 *   hah3-sd, so the merge pipeline's per-event source-kennel guard accepts
 *   the rows. Reconcile risk is zero — historical events are far outside
 *   the 90-day reconcile window, so future live scrapes won't cancel them.
 *
 * Coverage limit:
 *   The history page only carries date + title + kennel; hares / cost /
 *   trail type / dog friendly / pre-lube fields stay null on backfilled
 *   rows. That's expected and documented in #1314.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-hah3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-hah3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { backfillSdh3HistoryKennel } from "./lib/sdh3-history-backfill";

backfillSdh3HistoryKennel({
  kennelCode: "hah3-sd",
  kennelDisplayName: "Half-Assed",
  label: "Walking SDH3 history.shtml for Half-Assed Hash entries",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
