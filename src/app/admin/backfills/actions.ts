"use server";

/**
 * Owner actions on backfill runs (docs/onboarding-backfill-automation-design.md 10.3).
 *
 * Halting needs no step-up (an agent can already halt by removing the label).
 * Resume, undo, and setting or clearing a cutoff by hand each need a fresh
 * second factor: the page verifies the owner's TOTP or backup code with Clerk,
 * fetches a fresh token, and mints a single-use nonce bound to this session,
 * action and target; the action itself then sends the nonce and another
 * fresh token, and the server runs all checks again. Reading plans needs none.
 */
import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseUtcNoonDate } from "@/lib/date";
import { refreshKennelEvidence } from "@/pipeline/kennel-evidence";
import type { BackfillStepUpAction } from "@/generated/prisma/client";
import { sha256 } from "@/lib/backfill/canonical";
import { consumeStepUpNonce, mintStepUpNonce, type StepUpBinding, type StepUpChecks } from "@/lib/backfill/step-up";
import { backfillMode } from "@/lib/backfill/agent";
import { serverStepUpChecks } from "@/lib/backfill/step-up-server";
import { advanceFromCaller } from "@/lib/backfill/service";
import { applyUndo, buildUndoPlan } from "@/lib/backfill/undo";
import { acquireLease, appendStep, recordStep, releaseLease } from "@/lib/backfill/run-state";

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; checks?: StepUpChecks };

interface Target {
  action: BackfillStepUpAction;
  runId?: string | null;
  kennelId?: string | null;
  /** The undo plan's hash, or the cutoff date being set. */
  payload?: string | null;
}

const payloadHash = (payload?: string | null) => (payload ? sha256(payload) : null);

type StepUpContext =
  | { ok: true; adminId: string; checks: StepUpChecks; binding: Omit<StepUpBinding, "action" | "runId" | "kennelId" | "payloadHash"> }
  | { ok: false; error: string; checks?: StepUpChecks };

/** The signed-in admin, the server's step-up checks on this fresh token, and the session binding. */
async function stepUpContext(freshToken: string): Promise<StepUpContext> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorized" };
  const { checks, clerkSessionId, clerkUserId } = await serverStepUpChecks(freshToken);
  if (!clerkSessionId || !clerkUserId) return { ok: false, error: "No session", checks };
  return { ok: true, adminId: admin.id, checks, binding: { clerkSessionId, adminUserId: clerkUserId } };
}

const refused = (checks: StepUpChecks) => `Step-up refused: ${checks.refusals.join(", ")}`;

/** Step 1 of a step-up action: mint a nonce after the checks pass on this fresh token. */
export async function mintStepUp(target: Target, freshToken: string): Promise<Result<{ nonce: string }>> {
  const ctx = await stepUpContext(freshToken);
  if (!ctx.ok) return ctx;
  const minted = await mintStepUpNonce(
    { ...ctx.binding, action: target.action, runId: target.runId, kennelId: target.kennelId, payloadHash: payloadHash(target.payload) },
    ctx.checks,
  );
  return minted.ok ? { ok: true, data: { nonce: minted.nonce } } : { ok: false, error: refused(ctx.checks), checks: ctx.checks };
}

/** Step 2: spend the nonce; the checks run again on this request's fresh token. */
async function spendStepUp(target: Target, nonce: string, freshToken: string): Promise<Result<{ by: string; checks: StepUpChecks }>> {
  const ctx = await stepUpContext(freshToken);
  if (!ctx.ok) return ctx;
  const used = await consumeStepUpNonce(
    nonce,
    { ...ctx.binding, action: target.action, runId: target.runId, kennelId: target.kennelId, payloadHash: payloadHash(target.payload) },
    ctx.checks,
  );
  if (!used.ok) return { ok: false, error: used.reason === "checks" ? refused(ctx.checks) : "The step-up expired or was already used", checks: ctx.checks };
  return { ok: true, data: { by: ctx.adminId, checks: ctx.checks } };
}

/** Halt a run where it is. No step-up (design 10.3). */
export async function haltRun(runId: string): Promise<Result> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorized" };
  const token = await acquireLease(runId, ["PLANNED", "APPLYING"]);
  if (!token) return { ok: false, error: "The run isn't haltable now (finished, or a step is running; try again in a minute)" };
  await releaseLease(runId, token, { status: "HALTED", reasonCodes: ["halted by the owner"] });
  await appendStep(runId, recordStep("halt", admin.id));
  revalidatePath(`/admin/backfills/${runId}`);
  return { ok: true };
}

export async function resumeRun(runId: string, nonce: string, freshToken: string): Promise<Result> {
  // G16: a resume advances the run, which only BACKFILL_AUTOMATION=apply allows.
  if (backfillMode() !== "apply") return { ok: false, error: `BACKFILL_AUTOMATION is ${backfillMode()}` };
  const spent = await spendStepUp({ action: "RESUME", runId }, nonce, freshToken);
  if (!spent.ok) return spent;
  const result = await advanceFromCaller(runId, spent.data!.by, { resume: true });
  revalidatePath(`/admin/backfills/${runId}`);
  return { ok: true, data: result.status };
}

/** The undo plan's counts and hash. Read-only; no step-up. */
export async function getUndoPlan(runId: string): Promise<Result<{ hash: string; delete: number; keep: Array<{ eventId: string; reason: string }>; rawEvents: number; slots: number }>> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorized" };
  const { plan, hash } = await buildUndoPlan(runId);
  return { ok: true, data: { hash, delete: plan.deleteEventIds.length, keep: plan.keep, rawEvents: plan.rawEventsToDelete, slots: plan.slots.length } };
}

/** Confirm an undo: the nonce is bound to the undo plan's hash, which must still match (10.3). */
export async function undoRun(runId: string, confirmedHash: string, nonce: string, freshToken: string): Promise<Result> {
  const spent = await spendStepUp({ action: "UNDO", runId, payload: confirmedHash }, nonce, freshToken);
  if (!spent.ok) return spent;
  const result = await applyUndo(runId, { confirmedHash, by: spent.data!.by });
  revalidatePath(`/admin/backfills/${runId}`);
  if (result.status === "PLAN_CHANGED") return { ok: false, error: "The undo plan changed since you read it; read it again" };
  return { ok: true, data: result.status };
}

/** Continue an undo the owner already confirmed (UNDOING): its decision and plan are stored. */
export async function continueUndo(runId: string): Promise<Result> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false, error: "Not authorized" };
  const run = await prisma.backfillRun.findUnique({ where: { id: runId }, select: { status: true } });
  if (run?.status !== "UNDOING") return { ok: false, error: "The run isn't undoing" };
  const result = await applyUndo(runId, { by: admin.id });
  revalidatePath(`/admin/backfills/${runId}`);
  return { ok: true, data: result.status };
}

/** Set a kennel's archive cutoff by hand (an adopted kennel, design 6.5). */
export async function setCutoff(kennelId: string, date: string, nonce: string, freshToken: string): Promise<Result> {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? parseUtcNoonDate(date) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return { ok: false, error: "Date must be a real YYYY-MM-DD" };
  if (parsed.getTime() > Date.now()) return { ok: false, error: "A cutoff must be in the past" };
  const spent = await spendStepUp({ action: "SET_CUTOFF", kennelId, payload: date }, nonce, freshToken);
  if (!spent.ok) return spent;
  const set = await prisma.kennel.updateMany({ where: { id: kennelId, archiveCutoffDate: null }, data: { archiveCutoffDate: parseUtcNoonDate(date), archiveCutoffRunId: null } });
  revalidatePath("/admin/backfills");
  return set.count === 1 ? { ok: true } : { ok: false, error: "The kennel already has a cutoff" };
}

/** Clear a kennel's cutoff by hand: re-exposes its archive to other sources (6.5). */
export async function clearCutoff(kennelId: string, nonce: string, freshToken: string): Promise<Result> {
  const spent = await spendStepUp({ action: "CLEAR_CUTOFF", kennelId }, nonce, freshToken);
  if (!spent.ok) return spent;
  await prisma.kennel.update({ where: { id: kennelId }, data: { archiveCutoffDate: null, archiveCutoffRunId: null } });
  await refreshKennelEvidence([kennelId]);
  revalidatePath("/admin/backfills");
  return { ok: true };
}

/** The step-up probe: runs the same checks at mint and use, spends the nonce, writes only its own row (10.3). */
export async function probeStepUp(nonce: string, freshToken: string): Promise<Result<{ checks: StepUpChecks }>> {
  const spent = await spendStepUp({ action: "PROBE" }, nonce, freshToken);
  return spent.ok ? { ok: true, data: { checks: spent.data!.checks } } : spent;
}
