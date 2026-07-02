import { prisma } from "@/lib/db";

/**
 * ScrapeLog retention GC — keep the N most-recent ScrapeLogs per source.
 *
 * Every source scrape writes one ScrapeLog row (src/pipeline/scrape.ts), so the
 * table grows unbounded (~1 row/source/day from the dispatch cron, plus manual
 * admin scrapes). Left ungoverned it reached 54k rows / 59 MB and contributed to
 * a Railway volume-full outage. Nothing needs deep history: health analysis reads
 * only the last 10 SUCCESS + last 3 any per source (src/pipeline/health.ts), so a
 * per-source retention of 30 keeps every baseline with wide margin.
 *
 * Safe to run anytime: `Alert.scrapeLogId` is `ON DELETE SET NULL`
 * (prisma/migrations baseline `Alert_scrapeLogId_fkey`), so deleting an old
 * ScrapeLog referenced by an Alert simply nulls the Alert's link — the Alert row
 * survives. No other table references ScrapeLog.
 */
export const SCRAPE_LOG_KEEP_PER_SOURCE = 30;

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
  batches: number;
}

/**
 * Delete all but the `SCRAPE_LOG_KEEP_PER_SOURCE` most-recent ScrapeLogs per
 * source (ordered by `startedAt` desc), in batches of `SCRAPE_LOG_GC_BATCH_SIZE`.
 * Returns the total rows deleted.
 *
 * The surplus-row `row_number()` ranking runs ONCE (a single full sort of
 * ScrapeLog), not once per batch — re-running that window function inside a
 * delete loop would sort the whole table again on every iteration (O(batches
 * × N log N) instead of O(N log N)), which is exactly the wrong tradeoff on a
 * disk that's already under pressure. The resulting ids are then deleted via
 * plain indexed-PK `deleteMany` batches.
 */
export async function runScrapeLogGc(
  keepPerSource: number = SCRAPE_LOG_KEEP_PER_SOURCE,
  batchSize: number = SCRAPE_LOG_GC_BATCH_SIZE,
): Promise<ScrapeLogGcResult> {
  const surplus = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM (
      SELECT "id", row_number() OVER (
        PARTITION BY "sourceId" ORDER BY "startedAt" DESC
      ) AS rn
      FROM "ScrapeLog"
    ) ranked
    WHERE ranked.rn > ${keepPerSource}`;

  let deleted = 0;
  let batches = 0;
  for (let i = 0; i < surplus.length; i += batchSize) {
    const ids = surplus.slice(i, i + batchSize).map((r) => r.id);
    const { count } = await prisma.scrapeLog.deleteMany({ where: { id: { in: ids } } });
    deleted += count;
    batches++;
  }

  return { deleted, keptPerSource: keepPerSource, batches };
}
