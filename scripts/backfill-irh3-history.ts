/**
 * One-shot historical backfill for IRH3 (Iron Rule Hash House Harriers, San Diego).
 * Issue #1425.
 *
 * `https://sdh3.com/history.shtml` lists every San Diego–area hash back to
 * Dec 2006. Filtering for `(Iron Rule)` gives 346 total events. HashTracks
 * tracked only events from Aug 21 2025 forward before this backfill because
 * the live SDH3 source uses a 90-day reconcile window and the back catalog
 * can never enter via a wider hareline scrape (same reasoning as HAH3 #1314).
 *
 * Strategy: delegated to `backfillSdh3HistoryKennel` (scripts/lib/sdh3-history-backfill.ts).
 * The shared helper handles fetch, parse, partition, and merge-pipeline routing.
 *
 * Why attribute to "SDH3 Hareline":
 *   That source already has the 10-kennel SourceKennel link including
 *   irh3-sd (see prisma/seed-data/sources.ts kennelCodes array), so the
 *   merge pipeline's per-event source-kennel guard accepts the rows.
 *   Reconcile risk is zero — historical events are far outside the 90-day
 *   reconcile window, so future live scrapes won't cancel them.
 *
 * Coverage limit:
 *   The history page only carries date + start time + title + kennel; hares /
 *   location / description / cost / trail type fields stay null on backfilled
 *   rows. That's expected and documented in #1425.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-irh3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-irh3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { backfillSdh3HistoryKennel } from "./lib/sdh3-history-backfill";

backfillSdh3HistoryKennel({
  kennelCode: "irh3-sd",
  kennelDisplayName: "Iron Rule",
  label: "Walking SDH3 history.shtml for Iron Rule entries",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
