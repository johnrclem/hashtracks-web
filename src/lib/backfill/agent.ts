/**
 * Shared plumbing for the backfill agent API (`/api/agent/backfill/*`) and the
 * watch cron (docs/onboarding-backfill-automation-design.md 7).
 */
import { NextResponse } from "next/server";
import type { BackfillRun } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { bearerMatches } from "@/lib/audit-agent-auth";
import { sha256 } from "./canonical";
import { fetchArchiveAt, type ApprovalContext } from "./approval";

/** Recorded in a run's step log for calls made with the agent token (11.1). */
export const BACKFILL_AGENT_ID = "backfill-agent";
export const BACKFILL_WATCH_ID = "backfill-watch";
/** The watch cron's CronHeartbeat job name. */
export const WATCH_JOB = "backfill-watch";

/**
 * G16, the kill switch: `off` refuses every agent call, `shadow` refuses
 * `advance` (plans only), `apply` allows all. Anything else is `off`.
 */
export type BackfillMode = "off" | "shadow" | "apply";
export function backfillMode(): BackfillMode {
  const v = process.env.BACKFILL_AUTOMATION?.trim();
  return v === "shadow" || v === "apply" ? v : "off";
}

/** The deployed commit, for A1 and the run's batch log. */
export function deployedSha(): string | null {
  return process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
}

/** 401 without `BACKFILL_AGENT_TOKEN`; 403 when the kill switch refuses this call. */
export function rejectBackfillCall(req: Request, needs: "read" | "plan" | "advance"): NextResponse | null {
  if (!bearerMatches(req, process.env.BACKFILL_AGENT_TOKEN)) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }
  const mode = backfillMode();
  const allowed = mode === "apply" || (mode === "shadow" && needs !== "advance");
  if (!allowed) return NextResponse.json({ data: null, error: `BACKFILL_AUTOMATION is ${mode}` }, { status: 403 });
  return null;
}

/**
 * What responses may say about a run (7.2): status, counts, reason codes and
 * row-indexed verification results. Never existing events' dates or details.
 */
export function summarizeRun(run: BackfillRun) {
  const verification = run.verification as { ok?: boolean; failures?: unknown; notes?: unknown; coverage?: unknown; counts?: unknown } | null;
  return {
    id: run.id,
    prNumber: run.prNumber,
    status: run.status,
    reasonCodes: run.reasonCodes,
    counts: run.counts,
    cursor: run.cursor,
    splitDate: run.splitDate?.toISOString().slice(0, 10) ?? null,
    verification: verification
      ? { ok: verification.ok, failures: verification.failures, notes: verification.notes, coverage: verification.coverage, counts: verification.counts }
      : null,
    updatedAt: run.updatedAt.toISOString(),
  };
}

/** One `preview`/`plan` per PR per 10 minutes (7.2). */
export async function planRateLimited(prNumber: number, now = new Date()): Promise<boolean> {
  const recent = await prisma.backfillRun.count({ where: { prNumber, createdAt: { gt: new Date(now.getTime() - 10 * 60 * 1000) } } });
  return recent > 0;
}

/**
 * The archive a run was planned from, read again at its merge commit. Its
 * hash must still be the run's, or nothing proceeds.
 */
export async function fetchRunArchive(run: BackfillRun, ctx: ApprovalContext = {}): Promise<string> {
  if (!run.mergeSha) throw new Error(`Run ${run.id} has no merge commit`);
  const manifest = JSON.parse(await fetchArchiveAt(run.manifestPath, run.mergeSha, ctx)) as { archivePath?: string };
  const bytes = await fetchArchiveAt(String(manifest.archivePath ?? ""), run.mergeSha, ctx);
  if (sha256(bytes) !== run.archiveSha256) throw new Error(`Run ${run.id}: the archive at ${run.mergeSha} doesn't match the planned one`);
  return bytes;
}

/**
 * V5: the public kennel page's own `totalEvents` (from its rendered payload)
 * equals `expected`, the shared function's count at the same moment.
 */
export async function checkPublicPageCount(slug: string, expected: number, baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; shown: number | null }> {
  const res = await fetchImpl(`${baseUrl}/kennels/${encodeURIComponent(slug)}`, { cache: "no-store" });
  if (!res.ok) return { ok: false, shown: null };
  const m = /\\?"totalEvents\\?":(\d+)/.exec(await res.text());
  const shown = m ? Number(m[1]) : null;
  return { ok: shown === expected, shown };
}
