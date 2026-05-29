/**
 * One-shot historical backfill for NCH3 / North County Hash (San Diego).
 * Issue #1763.
 *
 * `https://sdh3.com/history.shtml` lists every SD-area hash back to Dec 2006.
 * Filtering for `(North County)` gives ~984 events spanning 2006-12-09 →
 * present. HashTracks tracked only 55 (date floor 2025-03-29) before this
 * backfill — the live SDH3 hareline source can only see upcoming events.
 *
 * Strategy: delegated to `backfillSdh3HistoryKennel` (scripts/lib/sdh3-history-backfill.ts).
 * Same pattern as backfill-mission-h4-history.ts (#1666) and backfill-irh3-history.ts (#1425).
 *
 * Why attribute to "SDH3 Hareline": that source already links nch3-sd (see
 * prisma/seed-data/sources.ts kennelCodes array + kennelNameMap "North County"),
 * so the merge pipeline's per-event source-kennel guard accepts the rows.
 * Reconcile risk is zero — historical events are far outside the live reconcile
 * window, so future live scrapes won't cancel them.
 *
 * Coverage limit: the history page only carries date + start time + title +
 * kennel; hares / location / description / cost stay null on backfilled rows.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-nch3-sd-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-nch3-sd-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { backfillSdh3HistoryKennel } from "./lib/sdh3-history-backfill";

backfillSdh3HistoryKennel({
  kennelCode: "nch3-sd",
  kennelDisplayName: "North County",
  label: "Walking SDH3 history.shtml for North County entries",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
