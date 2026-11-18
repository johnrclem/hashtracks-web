import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { runScrapeLogGc } from "@/pipeline/scrape-log-gc";

/**
 * Daily GC for ScrapeLog retention — keeps the most-recent
 * SCRAPE_LOG_KEEP_PER_SOURCE logs per source (plus a SCRAPE_LOG_KEEP_SUCCESS_PER_SOURCE
 * SUCCESS-only floor so a long outage can't wipe a source's health baseline) and
 * deletes the rest.
 *
 * Every scrape writes a ScrapeLog (src/pipeline/scrape.ts); without retention the
 * table grows unbounded and bloats the DB volume. Health analysis only needs the
 * last few per source, so old logs are pure churn (see src/pipeline/scrape-log-gc.ts).
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export const POST = withCronRun("cron:scrape-log-gc", async () => {
  const result = await runScrapeLogGc();
  console.log(
    `[scrape-log-gc] deleted ${result.deleted} logs in ${result.batches} batch(es), keeping ${result.keptPerSource} per source (+ ${result.keptSuccessPerSource} SUCCESS floor)`,
  );
  return NextResponse.json({
    data: {
      deleted: result.deleted,
      keptPerSource: result.keptPerSource,
      keptSuccessPerSource: result.keptSuccessPerSource,
      batches: result.batches,
    },
  });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
