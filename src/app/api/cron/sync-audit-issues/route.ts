import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { syncAuditIssues } from "@/pipeline/audit-issue-sync";
import { syncKennelLabels, summarizeLabelSync } from "@/pipeline/kennel-label-sync";

/**
 * Daily sync of GitHub `audit`-labeled issues into the AuditIssue mirror.
 * Runs two phases in order:
 *   1. Kennel + stream label sync — advisory. Failures are logged but never
 *      abort phase 2 because the audit sync can still function against
 *      whatever labels currently exist.
 *   2. Audit issue sync — load-bearing. Errors bubble up as 500.
 *
 * Triggered by Vercel Cron (GET) at 12:30 UTC or manually with Bearer
 * CRON_SECRET.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  let labelSyncSummary: ReturnType<typeof summarizeLabelSync> | { error: string };
  try {
    const result = await syncKennelLabels({ apply: true });
    labelSyncSummary = summarizeLabelSync(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-audit-issues] Label sync failed (continuing with audit sync):", err);
    labelSyncSummary = { error: message };
  }

  try {
    const issueSync = await syncAuditIssues();
    // Per-issue failures are collected in `issueSync.errors[]` rather than
    // thrown, so the sync always completes as much work as possible. But
    // returning 200 on a partially-stale mirror would hide the problem from
    // cron monitoring and the dashboard would silently drift. Surface any
    // partial failure as a 207 (Multi-Status) so Vercel's cron health check
    // fails loudly and operators notice.
    const status = issueSync.errors.length > 0 ? 207 : 200;
    return NextResponse.json(
      { data: { labelSync: labelSyncSummary, issueSync } },
      { status },
    );
  } catch (err) {
    console.error("[sync-audit-issues] Fatal error:", err);
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}
