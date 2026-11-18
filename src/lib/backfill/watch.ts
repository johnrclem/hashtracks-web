/**
 * The daily backfill-watch job (docs/onboarding-backfill-automation-design.md 7.3, 11.3).
 *
 * Resumes APPLYING runs whose lease expired, retries WAITING runs, plans
 * approved manifests from the last 30 days that have no run, re-verifies
 * runs from the last 7 days, and raises the liveness errors. It never starts
 * a fresh apply: PLANNED runs wait for the implementer or the owner (Phase 2).
 * Its own liveness is the AutomationRun row its route's `withCronRun` records.
 */
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { BACKFILL_WATCH_ID, backfillMode } from "./agent";
import { listApprovedManifestPrs, RetryableApprovalError } from "./approval";
import { advanceFromCaller, planFromPr, verifyFromCaller } from "./service";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface WatchReport {
  mode: string;
  resumed: string[];
  replanned: number[];
  planned: number[];
  reverified: Array<{ runId: string; ok: boolean }>;
  alerts: string[];
  errors: string[];
}

function alert(report: WatchReport, message: string): void {
  report.alerts.push(message);
  Sentry.captureMessage(`[backfill-watch] ${message}`, "error");
}

async function step(report: WatchReport, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    report.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    Sentry.captureException(err);
  }
}

export async function runBackfillWatch(now = new Date()): Promise<WatchReport> {
  const mode = backfillMode();
  const report: WatchReport = { mode, resumed: [], replanned: [], planned: [], reverified: [], alerts: [], errors: [] };
  if (mode === "apply") {
    await step(report, "resume", async () => {
      const stuck = await prisma.backfillRun.findMany({ where: { status: "APPLYING", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] }, select: { id: true } });
      for (const r of stuck) {
        const result = await advanceFromCaller(r.id, BACKFILL_WATCH_ID);
        report.resumed.push(`${r.id}:${result.status}`);
      }
    });
  }

  if (mode !== "off") {
    await step(report, "waiting", async () => {
      const waiting = await prisma.backfillRun.findMany({ where: { status: "WAITING" }, select: { prNumber: true } });
      for (const r of waiting) {
        await planFromPr(r.prNumber, false, BACKFILL_WATCH_ID);
        report.replanned.push(r.prNumber);
      }
    });
    await step(report, "unplanned", async () => {
      const approved = await listApprovedManifestPrs(new Date(now.getTime() - 30 * DAY)).catch((err) => {
        if (err instanceof RetryableApprovalError) return [];
        throw err;
      });
      for (const pr of approved) {
        const runs = await prisma.backfillRun.findMany({ where: { prNumber: pr.prNumber, status: { not: "PREVIEW" } }, select: { status: true } });
        if (runs.length === 0) {
          await planFromPr(pr.prNumber, false, BACKFILL_WATCH_ID);
          report.planned.push(pr.prNumber);
        }
        const verified = runs.some((r) => r.status === "VERIFIED" || r.status === "ADOPTED");
        if (!verified && pr.mergedAt && now.getTime() - Date.parse(pr.mergedAt) > 48 * HOUR) {
          alert(report, `PR #${pr.prNumber}: approved manifest has no VERIFIED run 48 hours after merge`);
        }
      }
    });
    await step(report, "reverify", async () => {
      const recent = await prisma.backfillRun.findMany({
        where: { status: { in: ["APPLIED", "VERIFIED", "VERIFY_FAILED"] }, OR: [{ verifiedAt: null }, { verifiedAt: { lt: new Date(now.getTime() - 20 * HOUR) } }], updatedAt: { gt: new Date(now.getTime() - 8 * DAY) } },
        select: { id: true, cutoffSetAt: true },
      });
      for (const r of recent) {
        if (r.cutoffSetAt && now.getTime() - r.cutoffSetAt.getTime() > 7 * DAY) continue;
        const verified = await verifyFromCaller(r.id);
        if (!verified) continue;
        const ok = verified.result.ok && (verified.v5?.ok ?? true);
        report.reverified.push({ runId: r.id, ok });
        if (!ok) alert(report, `run ${r.id}: 7-day re-check failed`);
      }
    });
  }

  // Liveness (11.3): silence counts as failure.
  await step(report, "liveness", async () => {
    const stale = await prisma.backfillRun.findMany({
      where: {
        OR: [
          { status: "APPLYING", leaseExpiresAt: { lt: new Date(now.getTime() - 2 * HOUR) } },
          { status: "APPLYING", leaseExpiresAt: null, updatedAt: { lt: new Date(now.getTime() - 2 * HOUR) } },
          { status: { in: ["HALTED", "VERIFY_FAILED"] }, updatedAt: { lt: new Date(now.getTime() - DAY) } },
        ],
      },
      select: { id: true, status: true },
    });
    for (const r of stale) alert(report, `run ${r.id} has been ${r.status} too long`);
  });

  return report;
}
