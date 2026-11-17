import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runBackfillWatch } from "@/lib/backfill/watch";

/**
 * Daily backfill watch (docs/onboarding-backfill-automation-design.md 7.3, 11.3).
 * Triggered by Vercel Cron (GET) or QStash (POST) or by hand with Bearer CRON_SECRET.
 * Honours BACKFILL_AUTOMATION: `off` only records liveness.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  try {
    return NextResponse.json({ data: await runBackfillWatch() });
  } catch (err) {
    console.error("[backfill-watch] failed:", err);
    Sentry.captureException(err);
    return NextResponse.json({ data: null, error: "backfill-watch failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
