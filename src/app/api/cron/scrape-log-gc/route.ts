import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runScrapeLogGc } from "@/pipeline/scrape-log-gc";

/**
 * Daily GC for ScrapeLog retention — keeps the most-recent
 * SCRAPE_LOG_KEEP_PER_SOURCE logs per source and deletes the rest.
 *
 * Every scrape writes a ScrapeLog (src/pipeline/scrape.ts); without retention the
 * table grows unbounded and bloats the DB volume. Health analysis only needs the
 * last few per source, so old logs are pure churn (see src/pipeline/scrape-log-gc.ts).
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runScrapeLogGc();
    console.log(
      `[scrape-log-gc] deleted ${result.deleted} logs in ${result.batches} batch(es), keeping ${result.keptPerSource} per source`,
    );
    return NextResponse.json({
      data: {
        deleted: result.deleted,
        keptPerSource: result.keptPerSource,
        batches: result.batches,
      },
    });
  } catch (err) {
    console.error("[scrape-log-gc] failed:", err);
    Sentry.captureException(err);
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/** Vercel Cron triggers GET requests. */
export async function GET(request: Request) {
  return POST(request);
}
