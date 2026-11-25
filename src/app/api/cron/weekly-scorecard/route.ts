import { NextResponse } from "next/server";

import { withCronRun } from "@/lib/cron-run";
import { runWeeklyScorecard } from "@/lib/scorecard/run";

/** The GSC URL Inspection sweep paces ~850 calls under Google's 600-a-minute quota (~2 minutes). */
export const maxDuration = 300;

/**
 * Weekly scorecard, Mondays 06:00 UTC (Vercel Cron; QStash or a manual Bearer CRON_SECRET POST also work).
 *
 * Computes every measure of the round's scorecard (`src/lib/scorecard/config.ts`) that has a
 * server source, stores the table in this run's `AutomationRun.metrics`, files one `lane:decision`
 * checkpoint issue (deduped by a marker, so a retry never files twice) and emails the owner the
 * same summary. The run is recorded as FAILED, so the watchdog alarms, when the issue or the email
 * didn't go out; the scorecard is stored either way.
 */
export const POST = withCronRun("cron:weekly-scorecard", async () => {
  const { stored, issue, email } = await runWeeklyScorecard();
  const delivered = issue.number !== null && email.sent;
  console.log(
    `[weekly-scorecard] ${stored.checkpoint ?? "weekly"}${stored.preview ? " (preview)" : ""}: ${stored.missed} missed; issue ${issue.reason}; email ${email.sent ? "sent" : email.reason}`,
  );
  return NextResponse.json({
    data: {
      success: delivered,
      checkpoint: stored.checkpoint,
      missed: stored.missed,
      issueNumber: issue.number,
      issue: issue.reason,
      email: email.sent ? "sent" : email.reason,
      runMetrics: stored,
    },
    ...(delivered ? {} : { error: `not delivered: issue ${issue.reason}; email ${email.sent ? "sent" : email.reason}` }),
  });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
