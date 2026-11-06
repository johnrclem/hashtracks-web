/**
 * Queue an audit finding, or record a deep-dive completion, for the scheduled
 * agent. Same handler and validation as `/api/audit/submit-finding`; only the
 * auth differs (an `AUDIT_AGENT_TOKEN` bearer instead of Origin plus a Clerk
 * admin session). Non-publishing: the promotion cron files reviewed findings.
 */
import { NextResponse } from "next/server";

import { handleAuditSubmission } from "@/lib/admin/audit-submit";
import { AUDIT_AGENT_SUBMITTER_ID, rejectUnlessAgent } from "@/lib/audit-agent-auth";
import { readJsonBody } from "@/lib/audit-api-auth";

export async function POST(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;
  return handleAuditSubmission(parsed.body, AUDIT_AGENT_SUBMITTER_ID);
}
