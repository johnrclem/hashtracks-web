/**
 * Active audit suppressions as markdown, for the scheduled agent.
 * Auth: `AUDIT_AGENT_TOKEN` bearer.
 */
import {
  SUPPRESSIONS_RESPONSE_HEADERS,
  renderSuppressionsMarkdown,
} from "@/lib/admin/audit-suppressions-md";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";

export async function GET(req: Request): Promise<Response> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;

  return new Response(await renderSuppressionsMarkdown(), {
    headers: SUPPRESSIONS_RESPONSE_HEADERS,
  });
}
