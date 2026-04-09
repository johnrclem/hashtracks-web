import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { syncAuditIssues } from "@/pipeline/audit-issue-sync";

/**
 * Daily sync of GitHub `audit`-labeled issues into the AuditIssue mirror.
 * Triggered by Vercel Cron (GET) at 12:30 UTC (30 min after the daily
 * automated audit at 12:00 UTC) or manually with Bearer CRON_SECRET.
 *
 * Full pull every run — re-derives stream + kennel from current labels so
 * manual relabels propagate. See src/pipeline/audit-issue-sync.ts for the
 * diff/event-emission strategy.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncAuditIssues();
    return NextResponse.json({ data: result });
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
