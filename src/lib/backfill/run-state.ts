/**
 * Run bookkeeping shared by apply, verify and undo
 * (docs/onboarding-backfill-automation-design.md 9.2, 10.2, 11.1).
 */
import { randomUUID } from "node:crypto";
import { Prisma, type BackfillRunStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { formatStatusLine, getStatusLine, KENNEL_EVIDENCE_SELECT } from "@/lib/kennel-status";

/** A lease lasts six minutes: longer than the 300 s function limit, so an expired lease means a dead caller. */
export const LEASE_MS = 6 * 60 * 1000;

/** The run's status lines with one more entry (before, after, beforeUndo, afterUndo; design 9.6). */
export function mergeStatusLines(current: Prisma.JsonValue | null, key: string, value: unknown): Prisma.InputJsonValue {
  const lines = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...lines, [key]: value } as Prisma.InputJsonValue;
}

export interface StepRecord {
  step: string;
  by: string;
  at: string;
  detail?: unknown;
}

export function recordStep(step: string, by: string, at: Date = new Date(), detail?: unknown): StepRecord {
  return { step, by, at: at.toISOString(), ...(detail === undefined ? {} : { detail }) };
}

/** Append a step to the run's step log (who started what, design 11.1). */
export async function appendStep(runId: string, step: StepRecord): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "BackfillRun"
    SET "stepLog" = "stepLog" || ${JSON.stringify([step])}::jsonb, "updatedAt" = NOW()
    WHERE id = ${runId}
  `;
}

/**
 * Take the run's lease with one conditional update that succeeds only if the
 * lease is free or expired (9.2) and the run is in one of `statuses`.
 * Returns the token, or null when another caller holds it.
 */
export async function acquireLease(runId: string, statuses: BackfillRunStatus[], now = new Date()): Promise<string | null> {
  const token = randomUUID();
  const taken = await prisma.backfillRun.updateMany({
    where: {
      id: runId,
      status: { in: statuses },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    },
    data: { leaseToken: token, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
  });
  return taken.count === 1 ? token : null;
}

/** Another caller took the run's lease (ours expired) mid-step: stop without writing more. */
export class LeaseLostError extends Error {
  constructor(runId: string) {
    super(`Lost the lease on backfill run ${runId}`);
    this.name = "LeaseLostError";
  }
}

/** Release the lease if we still hold it, applying `data` in the same update. */
export async function releaseLease(runId: string, token: string, data: Prisma.BackfillRunUpdateManyMutationInput = {}): Promise<boolean> {
  const released = await prisma.backfillRun.updateMany({
    where: { id: runId, leaseToken: token },
    data: { ...data, leaseToken: null, leaseExpiresAt: null },
  });
  return released.count === 1;
}

/** Stop a run where it is (8.1): HALTED with reasons, lease released. Nothing is rolled back. */
export async function haltRun(runId: string, token: string, reasons: string[]): Promise<void> {
  await releaseLease(runId, token, { status: "HALTED", reasonCodes: reasons });
}

/** The kennel's public status line, as the kennel page shows it (9.6). */
export async function kennelStatusLine(kennelId: string, now = new Date()): Promise<{ at: string; line: string; evidence: Record<string, string | null> }> {
  const kennel = await prisma.kennel.findUnique({ where: { id: kennelId }, select: KENNEL_EVIDENCE_SELECT });
  const evidence = kennel ?? { lastRunSeenAt: null, nextRunPostedAt: null, lastConfirmedAt: null, stoppedAt: null };
  const line = getStatusLine(evidence, now);
  return {
    at: now.toISOString(),
    line: line ? formatStatusLine(line, now) : "",
    evidence: Object.fromEntries(Object.entries(evidence).map(([k, v]) => [k, v ? (v as Date).toISOString() : null])),
  };
}

/**
 * Recompute Kennel.lastEventDate (a derived field, 9.1) with exactly the
 * nightly predicate of `backfillLastEventDates`: primary or co-host, not
 * cancelled, not manual, canonical. Any other predicate would flip-flop nightly.
 */
export async function recomputeLastEventDate(kennelId: string): Promise<void> {
  const latest = await prisma.event.aggregate({
    where: {
      OR: [{ kennelId }, { eventKennels: { some: { kennelId } } }],
      status: { not: "CANCELLED" },
      isManualEntry: { not: true },
      isCanonical: true,
    },
    _max: { date: true },
  });
  await prisma.kennel.update({ where: { id: kennelId }, data: { lastEventDate: latest._max.date } });
}
