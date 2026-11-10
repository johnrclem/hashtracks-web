/**
 * Read-only operational snapshot for the daily ops digest scheduled task.
 * Auth: `AUDIT_AGENT_TOKEN` bearer. Runs fixed SELECT queries only; see `buildOpsDigest`.
 */
import { NextResponse } from "next/server";

import { buildOpsDigest } from "@/lib/admin/ops-digest";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";

export async function GET(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;

  return NextResponse.json({ data: await buildOpsDigest() });
}
