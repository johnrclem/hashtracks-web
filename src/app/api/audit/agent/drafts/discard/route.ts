/**
 * Discard a queued finding before it's filed, recording why (for example
 * `{ "draftId": "…", "reason": "stale: backfill applied 2026-11-12" }`). The
 * draft is marked REJECTED, never deleted.
 * Auth: `AUDIT_AGENT_TOKEN` bearer.
 */
import { NextResponse } from "next/server";

import { DISCARD_REASON_MAX } from "@/lib/admin/audit-discard-reason";
import { discardQueuedDraft } from "@/lib/admin/audit-draft-queue";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";
import { readJsonBody } from "@/lib/audit-api-auth";

export async function POST(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;
  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.response;

  const { draftId, reason } = (parsed.body ?? {}) as Record<string, unknown>;
  const outcome =
    typeof draftId === "string" && draftId.length > 0
      ? await discardQueuedDraft(draftId, reason, "agent")
      : "invalid-reason";

  if (outcome === "invalid-reason") {
    return NextResponse.json(
      {
        data: null,
        error: `Body must be {draftId, reason}; reason is 1–${DISCARD_REASON_MAX} characters`,
      },
      { status: 400 },
    );
  }
  if (outcome === "not-queued") {
    return NextResponse.json(
      {
        data: null,
        error: "No queued draft with that id (already filed, suppressed or discarded?)",
      },
      { status: 404 },
    );
  }
  return NextResponse.json({ data: { discarded: true } });
}
