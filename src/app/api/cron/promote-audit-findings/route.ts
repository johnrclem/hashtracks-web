import { NextResponse } from "next/server";
import { verifyCronAuth } from "@/lib/cron-auth";
import { promoteAuditDrafts } from "@/pipeline/audit-draft-promoter";

/**
 * A full batch (30 drafts, paced a second apart for GitHub) takes ~1–2 minutes.
 * Must stay a literal (Next.js reads segment config statically). The promoter
 * derives its lock's idle timeout from it (`maxDuration` + 30 s).
 */
export const maxDuration = 300;

/**
 * Promote queued chrome-stream audit findings into GitHub issues.
 *
 * Dedicated route (not folded into /api/cron/audit) for failure isolation —
 * a GitHub outage degrades promotion without masking the structural audit —
 * and independent scheduling (runs after the agent's deposit window).
 * Triggered hourly by QStash (POST; `scripts/setup-qstash-schedule.ts`), daily
 * by Vercel Cron as a backstop (GET), or manually with Bearer
 * CRON_SECRET. Session-less: the external publish never rides a user session.
 */
export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await promoteAuditDrafts({ maxDurationSeconds: maxDuration });
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
