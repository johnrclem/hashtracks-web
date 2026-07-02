import { prisma } from "@/lib/db";

/**
 * ScrapeLog retention GC — keep the N most-recent ScrapeLogs per source
 * (any status), PLUS the M most-recent SUCCESS ScrapeLogs per source.
 *
 * Every source scrape writes one ScrapeLog row (src/pipeline/scrape.ts), so the
 * table grows unbounded (~1 row/source/day from the dispatch cron, plus manual
 * admin scrapes). Left ungoverned it reached 54k rows / 59 MB and contributed to
 * a Railway volume-full outage.
 *
 * The success-quota exists alongside the overall quota, not instead of it:
 * health.ts's baseline query filters `status: "SUCCESS"` and takes the last 10,
 * independent of how many non-SUCCESS rows sit more recently. A source with a
 * long outage (>SCRAPE_LOG_KEEP_PER_SOURCE consecutive FAILED/RUNNING scrapes
 * since its last SUCCESS) would have every SUCCESS row rank beyond the overall
 * cutoff and get deleted — wiping the baseline entirely. health.ts registers
 * EVENT_COUNT_ANOMALY/FIELD_FILL_DROP/STRUCTURE_CHANGE/UNMATCHED_TAGS as
 * "checked" on every successful scrape regardless of baseline size, but only
 * runs the actual detection `if (recentSuccessful.length > 0)` — an empty
 * baseline means the check silently no-ops AND any pre-existing trend alerts of
 * those types auto-resolve (no current alert exists to keep them open). That's
 * a real regression-detection gap, not just wasted history (found in review on
 * PR #2529 — a source can recover from an outage with a live bug and the first
 * scrape after recovery won't catch it).
 *
 * Safe to run anytime: `Alert.scrapeLogId` is `ON DELETE SET NULL`
 * (prisma/migrations baseline `Alert_scrapeLogId_fkey`), so deleting an old
 * ScrapeLog referenced by an Alert simply nulls the Alert's link — the Alert row
 * survives. No other table references ScrapeLog.
 */
export const SCRAPE_LOG_KEEP_PER_SOURCE = 30;

/**
 * SUCCESS-only retention floor. health.ts reads exactly the last 10 SUCCESS
 * rows per source for its trend baseline (src/pipeline/health.ts ~L401), so
 * this must be >= 10 regardless of how the overall quota above is tuned.
 */
export const SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE = 10;

/**
 * Rows deleted per `deleteMany` call. Batched (rather than one huge IN-list
 * statement) so each transaction's WAL burst stays small — important when the
 * GC is unblocking a near-full disk, where a single huge delete can itself
 * fail to extend WAL.
 */
export const SCRAPE_LOG_GC_BATCH_SIZE = 2000;

export interface ScrapeLogGcResult {
  deleted: number;
  keptPerSource: number;
  keptSuccessPerSource: number;
  batches: number;
}

/**
 * Delete every ScrapeLog EXCEPT: the `keepPerSource` most-recent rows per
 * source (any status), and the `keepSuccessPerSource` most-recent SUCCESS rows
 * per source — whichever set is larger wins per row. Deletes run in batches of
 * `batchSize`. Returns the total rows deleted.
 *
 * The surplus-row ranking runs ONCE (two window functions over a single sort
 * of ScrapeLog), not once per batch — re-running that inside a delete loop
 * would sort the whole table again on every iteration (O(batches × N log N)
 * instead of O(N log N)), which is exactly the wrong tradeoff on a disk that's
 * already under pressure. The resulting ids are then deleted via plain
 * indexed-PK `deleteMany` batches.
 */
export async function runScrapeLogGc(
  keepPerSource: number = SCRAPE_LOG_KEEP_PER_SOURCE,
  keepSuccessPerSource: number = SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE,
  batchSize: number = SCRAPE_LOG_GC_BATCH_SIZE,
): Promise<ScrapeLogGcResult> {
  const surplus = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM (
      SELECT "id", "status",
        row_number() OVER (
          PARTITION BY "sourceId" ORDER BY "startedAt" DESC
        ) AS overall_rn,
        row_number() OVER (
          PARTITION BY "sourceId", ("status" = 'SUCCESS') ORDER BY "startedAt" DESC
        ) AS status_rn
      FROM "ScrapeLog"
    ) ranked
    WHERE ranked.overall_rn > ${keepPerSource}
      AND (ranked.status <> 'SUCCESS' OR ranked.status_rn > ${keepSuccessPerSource})`;

  let deleted = 0;
  let batches = 0;
  for (let i = 0; i < surplus.length; i += batchSize) {
    const ids = surplus.slice(i, i + batchSize).map((r) => r.id);
    const { count } = await prisma.scrapeLog.deleteMany({ where: { id: { in: ids } } });
    deleted += count;
    batches++;
  }

  return { deleted, keptPerSource: keepPerSource, keptSuccessPerSource: keepSuccessPerSource, batches };
}
