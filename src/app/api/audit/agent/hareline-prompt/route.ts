/**
 * Daily hareline audit prompt for the scheduled agent. It's the same content
 * as the dashboard's "Copy daily prompt", built from live data, with
 * token-based filing instructions. Auth: `AUDIT_AGENT_TOKEN` bearer.
 */
import { NextResponse } from "next/server";

import { buildHarelinePrompt } from "@/lib/admin/hareline-prompt";
import { loadHarelinePromptInputs } from "@/lib/admin/hareline-prompt-inputs";
import { rejectUnlessAgent } from "@/lib/audit-agent-auth";

export async function GET(req: Request): Promise<NextResponse> {
  const rejected = rejectUnlessAgent(req);
  if (rejected) return rejected;

  const inputs = await loadHarelinePromptInputs();
  return NextResponse.json({
    data: { prompt: buildHarelinePrompt(inputs, { transport: "agent" }) },
  });
}
