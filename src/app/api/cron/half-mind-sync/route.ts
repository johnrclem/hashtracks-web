import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { withCronRun } from "@/lib/cron-run";
import { syncHalfMindDiscovery } from "@/pipeline/half-mind-discovery";

/**
 * Weekly Half-Mind refresh: re-reads the finder's public API for the configured scopes and
 * refreshes verified dates on linked kennels plus the review queue.
 *
 * Ships OFF. It runs only when HALF_MIND_SYNC_ENABLED is exactly "true", which the owner sets
 * once Half-Mind's maintainer is comfortable with weekly reads. Until then the admin
 * "Sync Half-Mind" button covers the same work.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export const POST = withCronRun("cron:half-mind-sync", async () => {
  if (process.env.HALF_MIND_SYNC_ENABLED !== "true") {
    return NextResponse.json({ data: { skipped: "disabled" } });
  }
  const result = await syncHalfMindDiscovery();
  console.log(
    `[half-mind-sync] scopes=${result.scopes} fetched=${result.fetched} created=${result.created} updated=${result.updated} refreshed=${result.refreshedChecks} errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    // Counts only: error strings can carry listing text.
    Sentry.captureMessage("Half-Mind sync finished with errors", {
      level: "warning",
      extra: { errorCount: result.errors.length, scopeCount: result.scopes },
    });
  }
  return NextResponse.json({ data: result });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
