/**
 * Backfill apply: one `advance` call is one step
 * (docs/onboarding-backfill-automation-design.md 9.2, 10.1, 10.2).
 *
 * PLANNED → (cutoff step) APPLYING → batches → finish → APPLIED → verify.
 * Every step runs under the run's lease and reads the run only after taking
 * it. A terminal guard failure halts the run where it is; nothing is rolled
 * back automatically.
 */
import { Prisma, type BackfillRun } from "@/generated/prisma/client";
import type { RawEventData } from "@/adapters/types";
import { prisma } from "@/lib/db";
import { parseUtcNoonDate } from "@/lib/date";
import { formatYmdInTimezone } from "@/lib/timezone";
import { processRawEvents, prepareRowForMerge, BackfillRowRejected, CreateOnlyViolation } from "@/pipeline/merge";
import { refreshKennelEvidence, refreshScheduleOnlyFlags } from "@/pipeline/kennel-evidence";
import { byCodeUnit, isoDay } from "./canonical";
import { parseArchive } from "./manifest";
import { scanArchiveForPii } from "./pii";
import { checkLiveCoverage, checkRowRouting, checkStretchGap } from "./guards";
import {
  displayedRunKeys,
  existingRunNumbers,
  findSplitDate,
  FIRST_BATCH_ROWS,
  MAX_APPLIES_PER_DAY,
  normalizeArchiveRow,
  occupiedDateCount,
  type StoredPlan,
} from "./plan";
import { acquireLease, appendStep, haltRun, kennelStatusLine, LeaseLostError, mergeStatusLines, recomputeLastEventDate, recordStep, releaseLease } from "./run-state";
import { v3Snapshot, v4Intruders, verifyRows, type VerificationResult } from "./verify";

/** At most 200 rows a batch, sized to use at most 150 s of the 300 s limit (9.2). */
export const MAX_BATCH_ROWS = 200;
export const BATCH_TIME_BUDGET_MS = 150_000;
/** A RUNNING scrape log older than this counts as finished (9.2). */
const STALE_SCRAPE_MS = 10 * 60 * 1000;

export type AdvanceResult =
  | { status: "BUSY" }
  | { status: "DONE"; run: BackfillRun }
  | { status: "CUTOFF_SET" | "WAITING_FOR_SCRAPES" | "BATCH_WRITTEN" | "APPLIED" | "VERIFIED" | "VERIFY_FAILED" | "HALTED" | "WAITING"; run: BackfillRun; detail?: unknown };

export interface AdvanceOptions {
  /** `backfill-agent`, `backfill-watch` or an admin's user id (11.1). */
  by: string;
  /** The archive file's bytes (re-read from GitHub at S, by the caller). */
  archiveBytes: string;
  deployedSha: string | null;
  now?: Date;
  /** Resume after HALTED: only from the admin page after a step-up (10.3). */
  resume?: boolean;
}

type ArchiveRun = BackfillRun & { kennelId: string; archiveSourceId: string; originSourceId: string };

interface StepContext {
  run: ArchiveRun;
  plan: StoredPlan;
  token: string;
  opts: AdvanceOptions;
  now: Date;
}

const FINISHED = new Set(["APPLIED", "VERIFIED", "VERIFY_FAILED", "UNDONE", "UNDOING", "ADOPTED", "BLOCKED", "PREVIEW", "WAITING"]);

async function reload(runId: string): Promise<BackfillRun> {
  return prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } });
}

async function halt(ctx: StepContext, reasons: string[]): Promise<AdvanceResult> {
  await haltRun(ctx.run.id, ctx.token, reasons);
  return { status: "HALTED", run: await reload(ctx.run.id) };
}

async function release(ctx: StepContext, status: Exclude<AdvanceResult["status"], "BUSY" | "DONE" | "HALTED">, detail?: unknown): Promise<AdvanceResult> {
  await releaseLease(ctx.run.id, ctx.token);
  return { status, run: await reload(ctx.run.id), detail };
}

/** Take the next step of a PLANNED or APPLYING run (or a HALTED one being resumed). */
export async function advanceRun(runId: string, opts: AdvanceOptions): Promise<AdvanceResult> {
  const now = opts.now ?? new Date();
  const peek = await reload(runId);
  if (FINISHED.has(peek.status) || (peek.status === "HALTED" && !opts.resume)) return { status: "DONE", run: peek };
  const token = await acquireLease(runId, opts.resume ? ["HALTED"] : ["PLANNED", "APPLYING"], now);
  if (!token) return { status: "BUSY" };

  // Read the run only now that we hold its lease: a caller before us may have moved it.
  const run = await reload(runId);
  if (!run.kennelId || !run.archiveSourceId || !run.originSourceId || !run.plan) {
    await releaseLease(runId, token);
    return { status: "DONE", run };
  }
  const ctx: StepContext = { run: run as ArchiveRun, plan: run.plan as unknown as StoredPlan, token, opts, now };
  try {
    if (opts.resume) {
      await prisma.backfillRun.updateMany({ where: { id: runId, leaseToken: token }, data: { status: run.cutoffSetAt ? "APPLYING" : "PLANNED", reasonCodes: [] } });
      await appendStep(runId, recordStep("resume", opts.by, now));
    }
    // Route on real progress, not status: a run halted before its cutoff resumes with the cutoff step.
    if (!run.cutoffSetAt) return await cutoffStep(ctx);
    const done = await createdItemIndexes(run.id);
    if (Array.isArray(run.inFlightBatch) && run.inFlightBatch.length) return await batchStep(ctx);
    if (ctx.plan.toWrite.some((r) => !done.has(r.index))) return await batchStep(ctx);
    return await finishStep(ctx);
  } catch (err) {
    // Someone else holds the run now; they carry on from where it is.
    if (err instanceof LeaseLostError) return { status: "BUSY" };
    // An unexpected error (database, network): release the lease so the next
    // call retries; every written row is complete (10.2).
    await releaseLease(runId, token);
    throw err;
  }
}

async function createdItemIndexes(runId: string): Promise<Set<number>> {
  const items = await prisma.backfillRunItem.findMany({ where: { runId, outcome: "CREATED" }, select: { rowIndex: true } });
  return new Set(items.map((i) => i.rowIndex));
}

/**
 * The first step: recompute C (halt if it moved), check the daily limit and
 * that no other run is applying, set the kennel's archive cutoff, move to
 * APPLYING and record the status line. Writes no rows (9.2).
 */
async function cutoffStep(ctx: StepContext): Promise<AdvanceResult> {
  const { run, plan, now } = ctx;
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const splitNow = await findSplitDate(run.kennelId, run.originSourceId, formatYmdInTimezone(now, plan.kennelTimezone));
  if (splitNow !== plan.splitDate) return halt(ctx, [`cutoff: the split point moved from ${plan.splitDate} to ${splitNow ?? "none"}`]);
  const before = await kennelStatusLine(run.kennelId, now);
  // Admission (one run APPLYING, G13's daily cap) and the cutoff commit together
  // under one lock, so two runs for different kennels can't both be admitted.
  const outcome = await prisma.$transaction(async (tx) => {
    // One key for every run: admission is global (one run APPLYING at a time).
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('backfill-apply-admission'))::text`;
    const [startedToday, applying] = await Promise.all([
      tx.backfillRun.count({ where: { cutoffSetAt: { gte: dayStart } } }),
      tx.backfillRun.count({ where: { status: "APPLYING", id: { not: run.id } } }),
    ]);
    if (startedToday >= MAX_APPLIES_PER_DAY) return "g13" as const;
    if (applying > 0) return "applying" as const;
    const kennel = await tx.kennel.updateMany({
      where: { id: run.kennelId, archiveCutoffDate: null },
      data: { archiveCutoffDate: parseUtcNoonDate(plan.splitDate), archiveCutoffRunId: run.id },
    });
    if (kennel.count !== 1) return "taken" as const;
    await tx.backfillRunItem.createMany({
      data: plan.liveOwned.map((rowIndex) => ({ runId: run.id, rowIndex, outcome: "LIVE_OWNED" as const })),
      skipDuplicates: true,
    });
    const moved = await tx.backfillRun.updateMany({
      where: { id: run.id, leaseToken: ctx.token },
      data: { status: "APPLYING", cutoffSetAt: now, statusLines: mergeStatusLines(run.statusLines, "before", before) },
    });
    // Lost the lease: roll the cutoff back and let the lease holder carry on.
    if (moved.count !== 1) throw new LeaseLostError(run.id);
    return "set" as const;
  });
  if (outcome === "g13") return release(ctx, "WAITING", "G13: two applies already started today");
  if (outcome === "applying") return release(ctx, "WAITING", "another run is APPLYING");
  if (outcome === "taken") return halt(ctx, ["G19: the kennel gained an archive cutoff since the plan"]);
  await appendStep(run.id, recordStep("cutoff", ctx.opts.by, now, { splitDate: plan.splitDate }));
  return release(ctx, "CUTOFF_SET");
}

/** Scrapes of the kennel's sources that were running when the cutoff was set and may still be (9.2). */
async function scrapesStillRunning(kennelId: string, cutoffSetAt: Date, now: Date): Promise<number> {
  return prisma.scrapeLog.count({
    where: {
      status: "RUNNING",
      startedAt: { lte: cutoffSetAt, gt: new Date(now.getTime() - STALE_SCRAPE_MS) },
      source: { kennels: { some: { kennelId } } },
    },
  });
}

/** The next batch: plan rows without an item, in plan order, never splitting a same-date group (9.2). */
function nextBatch(plan: StoredPlan, done: Set<number>, size: number): number[] {
  const pending = plan.toWrite.filter((r) => !done.has(r.index));
  let end = Math.min(size, pending.length);
  while (end < pending.length && pending[end].date === pending[end - 1].date) end++;
  return pending.slice(0, end).map((r) => r.index);
}

/** Batch size from the measured time per row of the batches so far. */
function batchSize(batchLog: unknown): number {
  const log = (Array.isArray(batchLog) ? batchLog : []) as Array<{ rows: number; durationMs: number }>;
  const written = log.filter((b) => b.rows > 0);
  if (written.length === 0) return FIRST_BATCH_ROWS;
  const perRow = written.reduce((s, b) => s + b.durationMs, 0) / written.reduce((s, b) => s + b.rows, 0);
  return Math.max(1, Math.min(MAX_BATCH_ROWS, Math.floor(BATCH_TIME_BUDGET_MS / Math.max(perRow, 1))));
}

/** Before the first batch: nothing of the kennel before C is live-backed, and G20 still holds (9.2). */
async function preFirstBatchChecks(ctx: StepContext, rows: RawEventData[]): Promise<string[]> {
  const { run, plan } = ctx;
  const liveBacked = await prisma.event.count({
    where: { kennelId: run.kennelId, date: { lt: parseUtcNoonDate(plan.splitDate) }, rawEvents: { some: { source: { enabled: true } } } },
  });
  const problems = liveBacked > 0 ? [`cutoff: ${liveBacked} events before the split point are backed by an enabled source`] : [];
  problems.push(...checkStretchGap(rows.map((r) => r.date).sort(byCodeUnit), plan.splitDate, plan.expectedGaps).map((p) => `G20: ${p}`));
  const coverage = checkLiveCoverage(
    plan.liveOwned.map((i) => ({ index: i, date: rows[i].date, runNumber: rows[i].runNumber })),
    new Set(plan.corrections),
    await displayedRunKeys(run.kennelId),
  );
  problems.push(...coverage.problems.map((p) => `G20: ${p}`));
  return problems;
}

/** Per-batch guards (9.2): G4, G7, G8, G9 for the batch's rows, G12, G18. */
async function batchGuards(ctx: StepContext, rows: RawEventData[], batch: number[]): Promise<string[]> {
  const { run } = ctx;
  const [kennel, archive, origin, enabledLinks] = await Promise.all([
    prisma.kennel.findUniqueOrThrow({ where: { id: run.kennelId }, select: { kennelCode: true } }),
    prisma.source.findUniqueOrThrow({
      where: { id: run.archiveSourceId },
      select: { enabled: true, archiveOnly: true, replacedById: true, type: true, kennels: { select: { kennelId: true } } },
    }),
    prisma.source.findUniqueOrThrow({ where: { id: run.originSourceId }, select: { type: true } }),
    prisma.sourceKennel.findMany({ where: { kennelId: run.kennelId, source: { enabled: true } }, select: { sourceId: true } }),
  ]);
  const batchRows = batch.map((i) => rows[i]);
  const problems: string[] = [];
  if (checkRowRouting(batchRows, kennel.kennelCode).length) problems.push("G4: a batch row doesn't carry the kennel's code");
  if (archive.kennels.length !== 1 || archive.kennels[0].kennelId !== run.kennelId) problems.push("G4: the archive source's links changed");
  if (scanArchiveForPii(batchRows).length) problems.push("G8: a batch row contains a phone number or email");
  if (!archive.archiveOnly || archive.enabled || archive.replacedById || archive.type !== origin.type) problems.push("G12: the archive source changed");
  if (enabledLinks.length !== 1 || enabledLinks[0].sourceId !== run.originSourceId) problems.push("G18: the kennel's enabled sources changed");
  const dates = [...new Set(batchRows.map((r) => r.date))];
  const occupied = await occupiedDateCount(run.kennelId, dates, run.archiveSourceId);
  if (occupied > 0) problems.push(`G9: ${occupied} events appeared on the batch's dates`);
  const runNumbers = batchRows.map((r) => r.runNumber).filter((n): n is number => n != null);
  const taken = await existingRunNumbers(run.kennelId, runNumbers, run.archiveSourceId);
  if (taken.size > 0) problems.push(`G7: ${taken.size} of the batch's run numbers now exist on the kennel's events`);
  return problems;
}

/**
 * Record items for planned rows already written to the archive source (a
 * crashed batch's, 10.2): a RawEvent there with the row's fingerprint means done.
 */
async function recordWrittenRows(ctx: StepContext, indexes: number[]): Promise<Map<number, { id: string; eventId: string | null }>> {
  const byIndex = new Map(ctx.plan.toWrite.map((r) => [r.index, r]));
  const raws = await prisma.rawEvent.findMany({
    where: { sourceId: ctx.run.archiveSourceId, fingerprint: { in: indexes.map((i) => byIndex.get(i)!.fingerprint) } },
    select: { id: true, fingerprint: true, eventId: true },
  });
  const rawByFp = new Map(raws.map((r) => [r.fingerprint, r]));
  const written = new Map<number, { id: string; eventId: string | null }>();
  for (const i of indexes) {
    const raw = rawByFp.get(byIndex.get(i)!.fingerprint);
    if (raw) written.set(i, raw);
  }
  if (written.size) {
    const batchIndex = Array.isArray(ctx.run.batchLog) ? ctx.run.batchLog.length : 0;
    await prisma.backfillRunItem.createMany({
      data: [...written].map(([i, raw]) => ({
        runId: ctx.run.id, rowIndex: i, outcome: "CREATED" as const, fingerprint: byIndex.get(i)!.fingerprint, rawEventId: raw.id, eventId: raw.eventId, batchIndex,
      })),
      skipDuplicates: true,
    });
  }
  return written;
}

/** G14 on the batch's written rows, then V3 and V4 over the whole plan. */
async function postBatchChecks(ctx: StepContext, batch: number[], merge: { created: number; updated: number; restored: number; blocked: number; eventErrors: number }): Promise<string[]> {
  const { run, plan } = ctx;
  const problems: string[] = [];
  if (merge.created !== batch.length || merge.updated || merge.restored || merge.blocked || merge.eventErrors) {
    problems.push(`G14: created ${merge.created} of ${batch.length}, updated ${merge.updated}, restored ${merge.restored}, blocked ${merge.blocked}, errors ${merge.eventErrors}`);
  }
  const byIndex = new Map(plan.toWrite.map((r) => [r.index, r]));
  const events = await prisma.rawEvent.findMany({
    where: { sourceId: run.archiveSourceId, fingerprint: { in: batch.map((i) => byIndex.get(i)!.fingerprint) } },
    select: { fingerprint: true, event: { select: { kennelId: true, date: true, isScheduleOnly: true } } },
  });
  const eventByFp = new Map(events.map((r) => [r.fingerprint, r.event]));
  const wrong = batch.filter((i) => {
    const planned = byIndex.get(i)!;
    const e = eventByFp.get(planned.fingerprint);
    return !e || e.kennelId !== run.kennelId || isoDay(e.date) !== planned.date || e.isScheduleOnly !== planned.scheduleOnly;
  });
  if (wrong.length) problems.push(`G14: ${wrong.length} rows aren't the planned events`);
  const runEventIds = (await prisma.rawEvent.findMany({ where: { sourceId: run.archiveSourceId, eventId: { not: null } }, select: { eventId: true } })).map((r) => r.eventId!);
  const allDates = plan.toWrite.map((r) => r.date);
  if (run.v3SnapshotHash && (await v3Snapshot(run.kennelId, allDates, runEventIds)) !== run.v3SnapshotHash) problems.push("V3: static history near the written rows changed");
  const intruders = await v4Intruders(run.kennelId, plan.toWrite.filter((r) => batch.includes(r.index)).map((r) => r.date), runEventIds);
  if (intruders.length) problems.push(`V4: ${intruders.length} written dates show another event`);
  return problems;
}

async function batchStep(ctx: StepContext): Promise<AdvanceResult> {
  const { run, plan, opts, now } = ctx;
  const rows = parseArchive(opts.archiveBytes);

  // Wait for scrapes that were running when the cutoff was set (9.2).
  if (run.cutoffSetAt && (await scrapesStillRunning(run.kennelId, run.cutoffSetAt, now)) > 0) return release(ctx, "WAITING_FOR_SCRAPES");

  // Crash recovery: settle the in-flight batch from the archive source's RawEvents (10.2).
  if (Array.isArray(run.inFlightBatch) && run.inFlightBatch.length) {
    await recordWrittenRows(ctx, run.inFlightBatch as number[]);
    await prisma.backfillRun.updateMany({ where: { id: run.id, leaseToken: ctx.token }, data: { inFlightBatch: Prisma.DbNull } });
  }
  const done = await createdItemIndexes(run.id);
  if (!plan.toWrite.some((r) => !done.has(r.index))) return release(ctx, "BATCH_WRITTEN", { recovered: true });

  if (done.size === 0) {
    const problems = await preFirstBatchChecks(ctx, rows);
    if (problems.length) return halt(ctx, problems);
  }
  const batch = nextBatch(plan, done, batchSize(run.batchLog));
  const guardProblems = await batchGuards(ctx, rows, batch);
  if (guardProblems.length) return halt(ctx, guardProblems);

  // Fingerprints must still match the plan's (a deploy can change normalisation, 10.1).
  const byIndex = new Map(plan.toWrite.map((r) => [r.index, r]));
  const copies = batch.map((i) => normalizeArchiveRow(rows[i]));
  const drift = batch.filter((i, k) => prepareRowForMerge(copies[k]).fingerprint !== byIndex.get(i)!.fingerprint);
  if (drift.length) return halt(ctx, [`fingerprint: ${drift.length} rows no longer match the plan's fingerprints`]);

  await prisma.backfillRun.updateMany({ where: { id: run.id, leaseToken: ctx.token }, data: { inFlightBatch: batch as unknown as Prisma.InputJsonValue } });
  const started = Date.now();
  let merge;
  try {
    merge = await processRawEvents(run.archiveSourceId, copies, { backfill: { scheduleOnly: new Map(copies.map((row, k) => [row, byIndex.get(batch[k])!.scheduleOnly])) } });
  } catch (err) {
    if (!(err instanceof CreateOnlyViolation) && !(err instanceof BackfillRowRejected)) throw err;
    await recordWrittenRows(ctx, batch);
    await prisma.backfillRun.updateMany({ where: { id: run.id, leaseToken: ctx.token }, data: { inFlightBatch: Prisma.DbNull } });
    const what = err instanceof CreateOnlyViolation ? `would match an existing event (${err.path})` : `was rejected (${err.reason})`;
    return halt(ctx, [`G14: row ${batch[err.index]} ${what}`]);
  }
  const durationMs = Date.now() - started;

  await recordWrittenRows(ctx, batch);
  const problems = await postBatchChecks(ctx, batch, merge);
  // Bookkeeping only while we still hold the lease: the cursor is the count of written rows.
  const cursor = (await createdItemIndexes(run.id)).size;
  await prisma.$executeRaw`
    UPDATE "BackfillRun"
    SET "cursor" = ${cursor},
        "inFlightBatch" = NULL,
        "batchLog" = "batchLog" || ${JSON.stringify([{ rows: batch.length, durationMs, deployedSha: opts.deployedSha, by: opts.by, at: now.toISOString() }])}::jsonb,
        "updatedAt" = NOW()
    WHERE id = ${run.id} AND "leaseToken" = ${ctx.token}
  `;
  if (problems.length) return halt(ctx, problems);
  return release(ctx, "BATCH_WRITTEN", { rows: batch.length, durationMs });
}

/**
 * Every planned row has a CREATED item: recompute lastEventDate, refresh the
 * schedule-only flags over the archive source and then the kennel's evidence
 * (in that order: the second reads the first), record the status line, set
 * APPLIED and verify (9.2). A failed refresh leaves the run APPLYING, and the
 * next advance retries only this step.
 */
async function finishStep(ctx: StepContext): Promise<AdvanceResult> {
  const { run, now, opts } = ctx;
  await recomputeLastEventDate(run.kennelId);
  await refreshScheduleOnlyFlags({ sourceId: run.archiveSourceId, since: new Date(0) });
  await refreshKennelEvidence([run.kennelId], now);
  const after = await kennelStatusLine(run.kennelId, now);
  const finished = await releaseLease(run.id, ctx.token, { status: "APPLIED", statusLines: mergeStatusLines(run.statusLines, "after", after) });
  if (!finished) throw new LeaseLostError(run.id);
  await appendStep(run.id, recordStep("finish", opts.by, now));
  try {
    const result = await runVerification(run.id, opts.archiveBytes, opts.deployedSha, now);
    return { status: result.ok ? "VERIFIED" : "VERIFY_FAILED", run: await reload(run.id), detail: result };
  } catch (err) {
    // Left APPLIED: the verify route or the watch cron verifies it again (7.3).
    console.error(`[backfill] verify after finish failed for ${run.id}:`, err);
    return { status: "APPLIED", run: await reload(run.id) };
  }
}

/** Run V1–V4 for an applied run and record the result (9.3). Re-runnable for the 7-day re-checks. */
export async function runVerification(runId: string, archiveBytes: string, deployedSha: string | null, now = new Date()): Promise<VerificationResult> {
  const run = await reload(runId);
  if (!run.kennelId || !run.plan) throw new Error(`Run ${runId} has no plan`);
  const plan = run.plan as unknown as StoredPlan;
  const rows = parseArchive(archiveBytes);
  const result = await verifyRows({
    runId,
    kennelId: run.kennelId,
    plan,
    plannedOnSha: run.plannedOnSha,
    deployedSha,
    v3SnapshotHash: run.v3SnapshotHash,
    liveRows: plan.liveOwned.map((i) => ({ index: i, date: rows[i].date, runNumber: rows[i].runNumber })),
    now,
  });
  await prisma.backfillRun.updateMany({
    where: { id: runId, status: { in: ["APPLIED", "VERIFIED", "VERIFY_FAILED"] } },
    data: { status: result.ok ? "VERIFIED" : "VERIFY_FAILED", verification: result as unknown as Prisma.InputJsonValue, verifiedAt: now },
  });
  return result;
}
