/**
 * One-shot historical backfill for Black Sheep H3 (BSH3, Atlanta).
 * Issue #1573.
 *
 * Sibling to `backfill-mlh4-history.ts` — same Atlanta Hash Board phpBB
 * forum, different sub-forum. The recurring Atom feed at
 * `/app.php/feed/forum/5` is a rolling 15-entry window; the topic listing
 * at `/viewforum.php?f=5` carries 92 historical topics. This script walks
 * them through the shared `walkAtlantaForum` helper (which reuses the live
 * adapter's parser, so backfill stays in lockstep with the recurring scrape).
 *
 * See `backfill-mlh4-history.ts` for the parity / idempotency / partitioning
 * guarantees — they apply identically here.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-black-sheep-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-black-sheep-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { walkAtlantaForum } from "@/lib/atlanta-forum-walker";

runBackfillScript({
  sourceName: "Atlanta Hash Board",
  kennelTimezone: "America/New_York",
  label: "Walking Atlanta Hash Board forum 5 (Black Sheep) — every page",
  fetchEvents: () =>
    walkAtlantaForum({ forumId: 5, kennelTag: "bsh3", hashDay: "Sunday" }),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
