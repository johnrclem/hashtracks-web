/**
 * Next kennel for the scheduled deep-dive agent, plus its ready-to-run prompt.
 *
 * Auth: `AUDIT_AGENT_TOKEN` bearer (see `@/lib/audit-agent-auth`). The queue
 * is the same rotation the `/admin/audit` dashboard shows: never-dived first,
 * then oldest deep dive. A kennel leaves the head of the queue when the agent
 * POSTs a `completion` marker to `/api/audit/agent/submit-finding`.
 */
import { NextResponse } from "next/server";

import { buildDeepDivePrompt } from "@/lib/admin/deep-dive-prompt";
import { loadDeepDiveQueue } from "@/lib/admin/deep-dive-queue";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";

export async function GET(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;

  const [kennel] = await loadDeepDiveQueue(1);
  if (!kennel) {
    return NextResponse.json({ data: null, meta: { reason: "queue-empty" } });
  }

  return NextResponse.json({
    data: { kennel, prompt: buildDeepDivePrompt(kennel, { transport: "agent" }) },
  });
}
