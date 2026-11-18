import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { runBackfillWatch } from "@/lib/backfill/watch";

/**
 * Daily backfill watch (docs/onboarding-backfill-automation-design.md 7.3, 11.3).
 * Triggered by Vercel Cron (GET) or QStash (POST) or by hand with Bearer CRON_SECRET.
 * Honours BACKFILL_AUTOMATION: `off` only records liveness. `withCronRun` does the
 * auth, records the run (its liveness, for the watchdog and the digest) and reports
 * a thrown error; a step that failed inside the watch marks the run FAILED too.
 */
export const maxDuration = 300;

export const POST = withCronRun("cron:backfill-watch", async () => {
  const report = await runBackfillWatch();
  return NextResponse.json({ data: { ...report, success: report.errors.length === 0 } });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
