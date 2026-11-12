/**
 * Findings still waiting in the review queue (PENDING, or ERROR under the
 * retry cap), for an agent or operator session checking them before the daily
 * promotion run. Optional `?kennelCode=` filter; `?includeBody=1` adds each
 * finding's markdown body (up to 32 KB each). Read-only.
 * Auth: `AUDIT_AGENT_TOKEN` bearer.
 */
import { NextResponse } from "next/server";

import { loadQueuedDrafts } from "@/lib/admin/audit-draft-queue";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";

const DRAFTS_LIMIT = 100;

export async function GET(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;

  const params = new URL(req.url).searchParams;
  const drafts = await loadQueuedDrafts({
    kennelCode: params.get("kennelCode") ?? undefined,
    limit: DRAFTS_LIMIT,
    includeBody: params.get("includeBody") === "1",
  });
  return NextResponse.json({
    data: drafts.map(({ kennel, ...d }) => ({ ...d, kennelShortName: kennel?.shortName ?? null })),
  });
}
