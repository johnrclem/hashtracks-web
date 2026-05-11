/**
 * One-shot historical backfill for IH3 (Ithaca H3).
 * Issue #1345.
 *
 * `http://ithacah3.org/hair_line-trail_log/` carries ~99 past trails
 * (#999–#1097, 2022-09-04 → 2025-07-20). The live hare-line adapter only
 * fetches upcoming runs, so before this backfill HashTracks showed just
 * 5 past events vs. the source's ~1,123 lifetime runs.
 *
 * Strategy:
 *   1. Fetch the Trail Log archive via `fetchHTMLPage`.
 *   2. Parse rows with `parseTrailLog` (lives next to the live adapter so
 *      schema drift surfaces in unit tests, not at backfill time).
 *   3. Attribute to the existing "IH3 Website Hareline" source — already
 *      `SourceKennel`-linked to `ih3`, so the per-event merge guard accepts
 *      every row with no seed change.
 *   4. `runBackfillScript` partitions to past-only (date < today
 *      America/New_York) and routes through the merge pipeline.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`. The
 *   fingerprint is deterministic over the parsed payload, so a second apply
 *   pass is a no-op on every row. The live page also duplicates `#1083`;
 *   fingerprint dedup absorbs it. Verified end-to-end:
 *     pass 1: created=99 updated=0 skipped=1   (the duplicate `#1083`)
 *     pass 2: created=0  updated=0 skipped=100 (full no-op idempotency)
 *
 * Cross-source overlap with existing past events:
 *   The Trail Log range is #999–#1097 (2022-09 → 2025-07-20). Any past IH3
 *   events that pre-date this backfill in prod were captured by the live
 *   hare-line scraper, which only carries upcoming runs; those past rows
 *   therefore have runNumber > #1097 and cannot overlap with the trail-log
 *   range. RawEvent fingerprint differs across sourceUrls, so even in a
 *   hypothetical overlap, two RawEvents would coexist (audit-trail
 *   immutability is intentional) and the canonical-Event matcher in merge.ts
 *   (`getSameDayEvents` + runNumber-based disambiguation) would route them
 *   to the same canonical Event without duplication.
 *
 * Reconcile risk:
 *   Zero. `src/pipeline/reconcile.ts` skips cancellation decisions on
 *   past-dated events ("a past-dated event missing from a scrape is not a
 *   cancellation signal"), so the live hare-line adapter's upcoming-only
 *   scrape will never cancel these historical rows.
 *
 * Coverage limit:
 *   The Trail Log carries date + title + location only. Hares, start time,
 *   cost stay null on backfilled rows. Acceptable per issue #1345.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-ih3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-ih3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { parseTrailLog } from "@/adapters/html-scraper/ithaca-h3";
import { fetchHTMLPage } from "@/adapters/utils";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "IH3 Website Hareline";
const KENNEL_TIMEZONE = "America/New_York";
const TRAIL_LOG_URL = "http://ithacah3.org/hair_line-trail_log/";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${TRAIL_LOG_URL}`);
  const page = await fetchHTMLPage(TRAIL_LOG_URL);
  if (!page.ok) {
    throw new Error(`Trail Log fetch failed: ${page.result.errors.join("; ")}`);
  }

  // No explicit sort here — `reportAndApplyBackfill` sorts past rows by date
  // after the partition.
  const events = parseTrailLog(page.html, TRAIL_LOG_URL);
  console.log(`  Parsed ${events.length} rows from the Trail Log archive.`);
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking IH3 Trail Log archive",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
