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
 * Rows deleted per statement. The delete is batched (rather than one ~40k-row
 * statement) so each transaction's WAL burst stays small — important when the GC
 * is unblocking a near-full disk, where a single huge delete can itself fail to
 * extend WAL.
 */
export const SCRAPE_LOG_GC_BATCH_SIZE = 2000;

/** Backstop so a mis-sized batch can never loop forever. */
const MAX_BATCHES = 1000;

export interface ScrapeLogGcResult {
  deleted: number;
  keptPerSource: number;
  batches: number;
}

/**
 * Delete all but the `SCRAPE_LOG_KEEP_PER_SOURCE` most-recent ScrapeLogs per
 * source (ordered by `startedAt` desc), in batches of `SCRAPE_LOG_GC_BATCH_SIZE`.
 * Returns the total rows deleted.
 */
export async function runScrapeLogGc(
  keepPerSource: number = SCRAPE_LOG_KEEP_PER_SOURCE,
  batchSize: number = SCRAPE_LOG_GC_BATCH_SIZE,
): Promise<ScrapeLogGcResult> {
  let deleted = 0;
  let batches = 0;

  for (let i = 0; i < MAX_BATCHES; i++) {
    // row_number() partitions by source, newest first; anything ranked beyond
    // `keepPerSource` is surplus. LIMIT bounds each statement's WAL footprint.
    const n = await prisma.$executeRaw`
      DELETE FROM "ScrapeLog"
      WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id", row_number() OVER (
            PARTITION BY "sourceId" ORDER BY "startedAt" DESC
          ) AS rn
          FROM "ScrapeLog"
        ) ranked
        WHERE ranked.rn > ${keepPerSource}
        LIMIT ${batchSize}
      )`;
    deleted += n;
    batches++;
    if (n < batchSize) break; // last (or empty) batch
  }

  return { deleted, keptPerSource: keepPerSource, batches };
}
