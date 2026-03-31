import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { runAudit } from "@/pipeline/audit-runner";
import { fileAuditIssues } from "@/pipeline/audit-issue";

/**
 * Daily data quality audit endpoint.
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 * Queries upcoming events for known bad patterns, picks the top 3 issue groups,
 * and files individual GitHub issues for autofix.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAudit();

    if (result.findings.length === 0) {
      return NextResponse.json({
        data: {
          eventsScanned: result.eventsScanned,
          findingsCount: 0,
          message: "Clean audit — no data quality issues",
        },
      });
    }

    const issueUrls = await fileAuditIssues(result.topGroups);

    return NextResponse.json({
      data: {
        eventsScanned: result.eventsScanned,
        findingsCount: result.findings.length,
        groupsFound: result.groups.length,
        topGroupsFiled: result.topGroups.length,
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
