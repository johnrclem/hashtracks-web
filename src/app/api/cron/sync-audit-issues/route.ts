import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { syncAuditIssues } from "@/pipeline/audit-issue-sync";
import { syncKennelLabels, summarizeLabelSync } from "@/pipeline/kennel-label-sync";

// The audit sync upserts the full corpus in one transaction (up to
// SYNC_TX_TIMEOUT_MS = 120s) plus the GitHub fetch — a catch-up run after
// an outage drains a large backlog in a single pass. Give the function
// the same 300s budget as the scrape cron so the platform doesn't 504
// before Prisma finishes (matches src/app/api/cron/scrape/[sourceId]).
export const maxDuration = 300;

/**
 * Daily sync of GitHub `audit`-labeled issues into the AuditIssue mirror.
 * Runs two phases in order:
 *   1. Kennel + stream label sync — advisory. Failures are logged but never
 *      abort phase 2 because the audit sync can still function against
 *      whatever labels currently exist.
 *   2. Audit issue sync — load-bearing. Errors bubble up as 500 (via `withCronRun`).
 *
 * Triggered by Vercel Cron (GET) at 12:30 UTC or manually with Bearer
 * CRON_SECRET.
 */
export const POST = withCronRun("cron:sync-audit-issues", async () => {
  let labelSyncSummary: ReturnType<typeof summarizeLabelSync> | { error: string };
  try {
    const result = await syncKennelLabels({ apply: true });
    labelSyncSummary = summarizeLabelSync(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-audit-issues] Label sync failed (continuing with audit sync):", err);
    labelSyncSummary = { error: message };
  }

  const issueSync = await syncAuditIssues();
  // Per-issue failures are collected in `issueSync.errors[]` rather than
  // thrown, so the sync always completes as much work as possible. A partial
  // failure answers 207 (Multi-Status) instead of 200, so it stands out in the
  // response and in the run row: `withCronRun` records the 207 as a SUCCESS
  // with summary "HTTP 207". A partial sync therefore keeps the watchdog's
  // liveness check satisfied. The watchdog marks this cron overdue only once
  // its last successful run is more than 26 hours old (missed or 500 runs).
  const status = issueSync.errors.length > 0 ? 207 : 200;
  return NextResponse.json({ data: { labelSync: labelSyncSummary, issueSync } }, { status });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
