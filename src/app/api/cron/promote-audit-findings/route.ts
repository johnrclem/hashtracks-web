import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { promoteAuditDrafts } from "@/pipeline/audit-draft-promoter";

/**
 * Promote queued chrome-stream audit findings into GitHub issues.
 *
 * Dedicated route (not folded into /api/cron/audit) for failure isolation —
 * a GitHub outage degrades promotion without masking the structural audit —
 * and independent scheduling (runs after the agent's deposit window).
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer
 * CRON_SECRET. Session-less: the external publish never rides a user session.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await promoteAuditDrafts();
    return NextResponse.json({ data: summary });
  } catch (err) {
    console.error("[promote-audit] Fatal error:", err);
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
