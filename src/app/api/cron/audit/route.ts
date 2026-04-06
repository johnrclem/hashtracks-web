import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runAudit, persistAuditLog, updateAuditLogIssuesFiled } from "@/pipeline/audit-runner";
import { fileAuditIssues } from "@/pipeline/audit-issue";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";

/**
 * Daily data quality audit endpoint.
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 * Queries upcoming events for known bad patterns, ranks issue groups,
 * and files up to 3 individual GitHub issues for the top findings.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Refresh lastEventDate cache — non-blocking; failures logged but don't block audit
    try {
      const backfilled = await backfillLastEventDates();
      if (backfilled > 0) console.log(`[audit] lastEventDate backfill: ${backfilled} kennels updated`);
    } catch (err) {
      console.error("[audit] lastEventDate backfill failed:", err instanceof Error ? err.message : err);
    }

    const result = await runAudit();

    if (result.findings.length === 0) {
      await persistAuditLog(result, 0);
      return NextResponse.json({
        data: {
          eventsScanned: result.eventsScanned,
          findingsCount: 0,
          message: "Clean audit — no data quality issues",
        },
      });
    }

    // Persist log first so a partial GitHub failure still leaves a record (and prevents retry duplication)
    const logId = await persistAuditLog(result, 0);
    // Pass all ranked groups — fileAuditIssues caps at 3 internally after dedup
    const issueUrls = await fileAuditIssues(result.groups);
    await updateAuditLogIssuesFiled(logId, issueUrls.length);

    return NextResponse.json({
      data: {
        eventsScanned: result.eventsScanned,
        findingsCount: result.findings.length,
        groupsFound: result.groups.length,
        issuesFiled: issueUrls.length,
        issueUrls,
        summary: result.summary,
      },
    });
  } catch (err) {
    console.error("[audit] Fatal error:", err);
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
