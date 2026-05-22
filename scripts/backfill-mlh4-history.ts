/**
 * One-shot historical backfill for Atlanta Moonlite H3 (MLH4).
 * Issue #1590.
 *
 * The Atlanta Hash Board phpBB feed at `/app.php/feed/forum/8` is a rolling
 * 15-entry window, so the recurring `AtlantaHashBoardAdapter` only sees the
 * most recent ~15 trails. The forum index at `/viewforum.php?f=8` lists 154
 * historical topics across ~7 pages — this script walks all of them, fetches
 * each topic's first-post body, and routes through `reportAndApplyBackfill`
 * so the merge pipeline dedupes against the recurring adapter's RawEvents
 * and upserts canonical Events in a single pass.
 *
 * **Parser parity:** the walker reuses `extractEventDate` + `extractEventFields`
 * from the live adapter (post-#1587/#1588 fix). Backfill inherits the same
 * run-number and start-time guarantees as the recurring scrape.
 *
 * **Idempotency:** `processRawEvents` dedupes by `(sourceId, fingerprint)`.
 * Re-running is a no-op modulo source-side edits.
 *
 * **Strict date partitioning:** `reportAndApplyBackfill` filters to
 * `date < today (America/New_York)` so the recurring adapter still owns the
 * upcoming window.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-mlh4-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-mlh4-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { walkAtlantaForum } from "./lib/atlanta-forum-walker";

runBackfillScript({
  sourceName: "Atlanta Hash Board",
  kennelTimezone: "America/New_York",
  label: "Walking Atlanta Hash Board forum 8 (Moonlite) — every page",
  fetchEvents: () =>
    walkAtlantaForum({ forumId: 8, kennelTag: "mlh4", hashDay: "Monday" }),
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
