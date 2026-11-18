/**
 * The steps the agent routes, the watch cron and the admin page share
 * (docs/onboarding-backfill-automation-design.md 7.2, 7.3): approval, then the
 * library call. Every call re-reads GitHub; nothing trusts a caller's claim.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { countKennelPageEvents, getKennelPageEvents } from "@/lib/kennel-page-events";
import {
  checkMergedPrApproval,
  fetchPrFiles,
  LabelMissingError,
  openPrHead,
  RetryableApprovalError,
  TerminalApprovalError,
  type ApprovalContext,
} from "./approval";
import { deployedSha, fetchRunArchive, checkPublicPageCount } from "./agent";
import { advanceRun, runVerification, type AdvanceResult } from "./apply";
import { planBackfill, type PlanOutcome } from "./plan";
import { haltRun, acquireLease } from "./run-state";

export type PlanCallResult =
  | { kind: "planned"; outcome: PlanOutcome }
  | { kind: "waiting"; reason: string }
  | { kind: "refused"; reason: string };

/**
 * POST /preview (open PR, at its head) or POST /plan (merged PR, at S, after
 * A1–A4). A retryable approval failure is reported as waiting and stores
 * nothing; a terminal one is refused.
 */
export async function planFromPr(prNumber: number, preview: boolean, by: string, ctx: ApprovalContext = {}): Promise<PlanCallResult> {
  try {
    const deployed = deployedSha();
    let ref: string;
    let ids: { mergeSha: string | null; stampedSha: string | null; mergedHeadSha: string | null };
    if (preview) {
      ref = await openPrHead(prNumber, ctx);
      ids = { mergeSha: null, stampedSha: null, mergedHeadSha: null };
    } else {
      const approval = await checkMergedPrApproval(prNumber, deployed, ctx);
      ref = approval.mergeSha;
      ids = { mergeSha: approval.mergeSha, stampedSha: approval.stampedSha, mergedHeadSha: approval.headSha };
    }
    const files = await fetchPrFiles(prNumber, ref, ctx);
    const outcome = await planBackfill({
      prNumber,
      ...ids,
      manifestPath: files.manifestPath,
      manifestBytes: files.manifestBytes,
      archiveBytes: files.archiveBytes,
      changedFiles: files.changedFiles,
      migrationSql: files.migrationSql,
      deployedSha: deployed,
      preview,
      startedBy: by,
    });
    return { kind: "planned", outcome };
  } catch (err) {
    if (err instanceof RetryableApprovalError) return { kind: "waiting", reason: err.message };
    if (err instanceof TerminalApprovalError) return { kind: "refused", reason: err.message };
    throw err;
  }
}

export type AdvanceCallResult = AdvanceResult | { status: "WAITING"; reason: string } | { status: "REFUSED"; reason: string };

/**
 * POST /runs/:id/advance: G1 again (A1–A4 against GitHub, retryable failures
 * write nothing, a terminal one halts the run), the archive re-read at S with
 * its hash checked, then one step.
 */
export async function advanceFromCaller(runId: string, by: string, opts: { resume?: boolean; ctx?: ApprovalContext } = {}): Promise<AdvanceCallResult> {
  const run = await prisma.backfillRun.findUnique({ where: { id: runId } });
  if (!run) return { status: "REFUSED", reason: "no such run" };
  try {
    const approval = await checkMergedPrApproval(run.prNumber, deployedSha(), opts.ctx);
    if (approval.mergeSha !== run.mergeSha || approval.stampedSha !== run.stampedSha) {
      throw new TerminalApprovalError("G1: the approval no longer matches the plan's commits");
    }
    const archiveBytes = await fetchRunArchive(run, opts.ctx);
    return await advanceRun(runId, { by, archiveBytes, deployedSha: deployedSha(), resume: opts.resume });
  } catch (err) {
    // A removed label is retryable before a run exists, but for a run under way it halts it (10.2):
    // re-adding the label then needs the owner's resume, with a step-up.
    if (err instanceof RetryableApprovalError && !(err instanceof LabelMissingError)) return { status: "WAITING", reason: err.message };
    if (err instanceof TerminalApprovalError || err instanceof LabelMissingError) {
      // Removing the label (or any terminal approval failure) halts the run at the next batch (10.2).
      if (run.status === "APPLYING") {
        const token = await acquireLease(runId, ["APPLYING"]);
        if (token) await haltRun(runId, token, [err.message]);
      }
      return { status: "REFUSED", reason: err.message };
    }
    throw err;
  }
}

/**
 * POST /runs/:id/verify: V1–V4, then V5 against the public kennel page. V5 is
 * saved with the run's verification, and a V5 failure makes the run
 * VERIFY_FAILED, so the run page and the digest see what the caller saw.
 */
export async function verifyFromCaller(runId: string, ctx: ApprovalContext = {}) {
  const run = await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId }, include: { kennel: { select: { slug: true } } } });
  if (!["APPLIED", "VERIFIED", "VERIFY_FAILED"].includes(run.status)) return null;
  const archiveBytes = await fetchRunArchive(run, ctx);
  const result = await runVerification(runId, archiveBytes, deployedSha());
  let v5: { ok: boolean; shown: number | null; expected: number } | null = null;
  if (run.kennelId && run.kennel) {
    const expected = countKennelPageEvents(await getKennelPageEvents(run.kennelId));
    const page = await checkPublicPageCount(run.kennel.slug, expected, getCanonicalSiteUrl());
    v5 = { ...page, expected };
    const ok = result.ok && v5.ok;
    await prisma.backfillRun.update({
      where: { id: runId },
      data: {
        status: ok ? "VERIFIED" : "VERIFY_FAILED",
        verification: { ...result, ok, v5 } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  return { result, v5 };
}
