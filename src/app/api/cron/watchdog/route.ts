import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { opsGithubFromEnv } from "@/lib/ops-github";
import { prismaWatchdogStore, resendMailer, runWatchdogExclusive, sentryAlarms } from "@/pipeline/watchdog";

/** Must stay a literal (Next.js reads segment config statically); the lock's idle timeout derives from it. */
export const maxDuration = 120;

/**
 * Ops watchdog: checks every automation in `src/lib/automation-registry.ts` against the side
 * effects it must leave, and raises or clears `lane:ops` alarms (Sentry, a GitHub issue, email).
 * See `src/pipeline/watchdog.ts`.
 *
 * Triggered hourly by QStash (POST; `scripts/setup-qstash-schedule.ts`), daily by Vercel Cron as
 * a backstop (GET), or manually with Bearer CRON_SECRET. Overlapping runs are serialised by an
 * advisory lock; the loser returns `{ skipped: "locked" }`.
 */
export const POST = withCronRun(
  "cron:watchdog",
  async () => {
    const result = await runWatchdogExclusive({
      store: prismaWatchdogStore({ lockIdleMs: (maxDuration + 30) * 1000 }),
      github: opsGithubFromEnv(),
      alarms: sentryAlarms,
      mailer: resendMailer,
      now: new Date(),
    });
    return NextResponse.json({ data: result });
  },
  { kind: "WATCHDOG" },
);

/** Vercel Cron triggers GET requests. */
export const GET = POST;
