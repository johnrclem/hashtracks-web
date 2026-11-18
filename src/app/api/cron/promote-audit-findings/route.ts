import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
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
export const POST = withCronRun("cron:promote-audit-findings", async () => {
  const summary = await promoteAuditDrafts({ maxDurationSeconds: maxDuration });
  return NextResponse.json({ data: summary });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
