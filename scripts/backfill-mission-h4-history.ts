/**
 * One-shot historical backfill for Mission H4 / Mission Harriettes (San Diego).
 * Issue #1666.
 *
 * `https://sdh3.com/history.shtml` lists every SD-area hash back to Dec 2006.
 * Filtering for `(Mission Harriettes)` gives ~157 events spanning 2006-12-20 →
 * present. HashTracks tracked only 15 (date floor 2025-03-26) before this
 * backfill — the live SDH3 hareline source can only see upcoming events, and
 * pre-2011 per-event detail pages are the only enrichment that still resolves
 * (post-2011 detail URLs all 404).
 *
 * Strategy: delegated to `backfillSdh3HistoryKennel` (scripts/lib/sdh3-history-backfill.ts).
 * Same pattern as backfill-hah3-history.ts (#1314) and backfill-irh3-history.ts (#1425).
 *
 * Why attribute to "SDH3 Hareline":
 *   That source already has the 10-kennel SourceKennel link including
 *   mh4-sd (see prisma/seed-data/sources.ts kennelCodes array), so the
 *   merge pipeline's per-event source-kennel guard accepts the rows.
 *   Reconcile risk is zero — historical events are far outside the live
 *   reconcile window, so future live scrapes won't cancel them.
 *
 * Coverage limit:
 *   The history page only carries date + start time + title + kennel; hares /
 *   location / description / cost fields stay null on backfilled rows. That's
 *   expected and documented in #1666.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mission-h4-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mission-h4-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { backfillSdh3HistoryKennel } from "./lib/sdh3-history-backfill";

backfillSdh3HistoryKennel({
  kennelCode: "mh4-sd",
  kennelDisplayName: "Mission Harriettes",
  label: "Walking SDH3 history.shtml for Mission Harriettes entries",
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
