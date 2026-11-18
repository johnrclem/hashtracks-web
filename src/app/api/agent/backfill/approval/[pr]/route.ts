/**
 * GET /api/agent/backfill/approval/:pr — A2–A4 against the PR's current head,
 * for the implementer's code-merge step (design 6.4). Returns the head the
 * owner approved; the implementer merges with `--match-head-commit <sha>`.
 * Read-only. Auth: BACKFILL_AGENT_TOKEN.
 */
import { NextResponse } from "next/server";
import { rejectBackfillCall } from "@/lib/backfill/agent";
import { checkOpenPrApproval, RetryableApprovalError, TerminalApprovalError } from "@/lib/backfill/approval";

export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ pr: string }> }): Promise<NextResponse> {
  const rejected = rejectBackfillCall(req, "read");
  if (rejected) return rejected;
  const pr = Number((await params).pr);
  if (!Number.isInteger(pr) || pr <= 0) return NextResponse.json({ data: null, error: "Bad PR number" }, { status: 400 });
  try {
    const approval = await checkOpenPrApproval(pr);
    return NextResponse.json({ data: { approved: true, approvedHeadSha: approval.stampedSha, headSha: approval.headSha } });
  } catch (err) {
    if (err instanceof RetryableApprovalError || err instanceof TerminalApprovalError) {
      return NextResponse.json({ data: { approved: false, retryable: err instanceof RetryableApprovalError, reason: err.message } });
    }
    throw err;
  }
}
