/**
 * Backfill undo (docs/onboarding-backfill-automation-design.md 10.3).
 *
 * The undo plan is read-only and hashed; the owner confirms its counts and the
 * confirm carries the hash, which must still match when recomputed. The apply
 * then hard-deletes one event per transaction through the shared delete
 * helper, in batches under the run's lease, and is resumable.
 */
import { Prisma, type BackfillRun } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { deleteLeakedEvent, DeleteSafetyViolationError, ForeignRawSourceError, recomputeCanonicalForSlots } from "@/lib/delete-leaked-event";
import { refreshKennelEvidence } from "@/pipeline/kennel-evidence";
import { byCodeUnit, canonicalJson, sha256 } from "./canonical";
import { acquireLease, appendStep, kennelStatusLine, LeaseLostError, mergeStatusLines, recomputeLastEventDate, recordStep, releaseLease } from "./run-state";
import { v3Snapshot } from "./verify";
import type { StoredPlan } from "./plan";

/** Events deleted per undo call: each is its own short transaction. */
export const UNDO_BATCH_EVENTS = 100;

const UNDOABLE = ["APPLYING", "HALTED", "APPLIED", "VERIFIED", "VERIFY_FAILED"] as const;

export interface UndoPlan {
  runId: string;
  /** Events created by the run that carry only its RawEvent and no user data. */
  deleteEventIds: string[];
  /** Events left exactly as they are, with the reason. */
  keep: Array<{ eventId: string; reason: string }>;
  /** RawEvents to delete: the run's, except on kept events. */
  rawEventsToDelete: number;
  /** Every (kennel, date) the run touched. */
  slots: Array<{ kennelId: string; date: string }>;
}

function keepReason(
  e: { _count: { attendances: number; kennelAttendances: number }; hares: Array<{ userId: string | null; sourceType: string }>; rawEvents: Array<{ sourceId: string }> },
  archiveSourceId: string,
): string | null {
  if (e._count.attendances > 0) return "attendance";
  if (e._count.kennelAttendances > 0) return "kennel attendance";
  if (e.hares.some((h) => h.userId !== null || h.sourceType !== "SCRAPED")) return "hare entered by a user or misman";
  if (e.rawEvents.some((r) => r.sourceId !== archiveSourceId)) return "another source's RawEvent joined it";
  return null;
}

/** The read-only undo plan and its hash (10.3). */
export async function buildUndoPlan(runId: string): Promise<{ plan: UndoPlan; hash: string }> {
  const run = await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } });
  if (!run.archiveSourceId || !run.kennelId) throw new Error(`Run ${runId} wrote nothing`);
  // Every event the archive source backs, not just itemized ones: a crashed
  // batch can leave written rows without items, and only this run writes to
  // its archive source (G19).
  const raws = await prisma.rawEvent.findMany({
    where: { sourceId: run.archiveSourceId, eventId: { not: null } },
    select: { eventId: true },
  });
  const ids = [...new Set(raws.map((r) => r.eventId!))];
  const events = await prisma.event.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      kennelId: true,
      date: true,
      _count: { select: { attendances: true, kennelAttendances: true } },
      hares: { select: { userId: true, sourceType: true } },
      rawEvents: { select: { sourceId: true } },
    },
  });
  const deleteEventIds: string[] = [];
  const keep: UndoPlan["keep"] = [];
  let rawEventsToDelete = 0;
  for (const e of events) {
    const reason = keepReason(e, run.archiveSourceId);
    if (reason) keep.push({ eventId: e.id, reason });
    else {
      deleteEventIds.push(e.id);
      rawEventsToDelete += e.rawEvents.length;
    }
  }
  const slots = [...new Map(events.map((e) => [`${e.kennelId}:${e.date.toISOString()}`, { kennelId: e.kennelId, date: e.date.toISOString().slice(0, 10) }])).values()];
  const plan: UndoPlan = { runId, deleteEventIds: deleteEventIds.sort(byCodeUnit), keep, rawEventsToDelete, slots };
  return { plan, hash: sha256(canonicalJson(plan)) };
}

export type UndoResult =
  | { status: "BUSY" | "PLAN_CHANGED" | "NOT_UNDOABLE" }
  | { status: "UNDOING" | "UNDONE"; run: BackfillRun; deleted: number; kept: number };

/**
 * Undo apply. The first call needs `confirmedHash` equal to a fresh undo
 * plan's hash; it stores that plan and moves the run to UNDOING. Every call
 * then deletes up to UNDO_BATCH_EVENTS events; the last one recomputes the
 * touched slots, lastEventDate and the kennel's evidence, checks V3, clears
 * the cutoff if nothing was kept, and sets UNDONE.
 */
export async function applyUndo(runId: string, opts: { confirmedHash?: string; by: string; now?: Date }): Promise<UndoResult> {
  const now = opts.now ?? new Date();
  const peek = await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } });
  if (peek.status !== "UNDOING" && !(UNDOABLE as readonly string[]).includes(peek.status)) return { status: "NOT_UNDOABLE" };
  const token = await acquireLease(runId, peek.status === "UNDOING" ? ["UNDOING"] : [...UNDOABLE], now);
  if (!token) return { status: "BUSY" };
  // Read the run only once we hold its lease.
  const run = await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } });

  try {
    let plan = run.undoPlan as unknown as UndoPlan | null;
    if (run.status !== "UNDOING") {
      const fresh = await buildUndoPlan(runId);
      if (!opts.confirmedHash || fresh.hash !== opts.confirmedHash) {
        await releaseLease(runId, token);
        return { status: "PLAN_CHANGED" };
      }
      plan = fresh.plan;
      const before = await kennelStatusLine(run.kennelId!, now);
      const confirmedPlan = plan;
      // One transaction: a crash can't leave the run UNDOING with events unitemized or keeps unmarked.
      await prisma.$transaction(
        async (tx) => {
          const moved = await tx.backfillRun.updateMany({
            where: { id: runId, leaseToken: token },
            data: {
              status: "UNDOING",
              undoPlan: confirmedPlan as unknown as Prisma.InputJsonValue,
              undoPlanHash: fresh.hash,
              statusLines: mergeStatusLines(run.statusLines, "beforeUndo", before),
            },
          });
          if (moved.count !== 1) throw new LeaseLostError(runId);
          await itemizeUnrecorded(tx, run, confirmedPlan);
          for (const reason of new Set(confirmedPlan.keep.map((k) => k.reason))) {
            await tx.backfillRunItem.updateMany({
              where: { runId, eventId: { in: confirmedPlan.keep.filter((k) => k.reason === reason).map((k) => k.eventId) } },
              data: { undoneAt: now, undoOutcome: "KEPT", undoReason: reason },
            });
          }
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      await appendStep(runId, recordStep("undo-confirm", opts.by, now, { hash: fresh.hash }));
    }
    if (!plan) throw new Error(`Run ${runId} is UNDOING without a stored undo plan`);

    const pending = (
      await prisma.backfillRunItem.findMany({
        where: { runId, undoneAt: null, eventId: { in: plan.deleteEventIds } },
        select: { eventId: true },
        take: UNDO_BATCH_EVENTS,
      })
    ).map((i) => i.eventId!);

    for (const eventId of pending) {
      let outcome: "DELETED" | "KEPT" = "DELETED";
      let reason: string | null = null;
      try {
        await deleteLeakedEvent(prisma as never, eventId, ["attendances", "kennelAttendances"], run.archiveSourceId!, { forbidUserHares: true });
      } catch (err) {
        if (err instanceof ForeignRawSourceError || err instanceof DeleteSafetyViolationError) {
          outcome = "KEPT";
          reason = err instanceof ForeignRawSourceError ? "another source's RawEvent joined it" : "user data appeared";
        } else throw err;
      }
      await prisma.backfillRunItem.updateMany({ where: { runId, eventId }, data: { undoneAt: now, undoOutcome: outcome, undoReason: reason } });
    }

    const remaining = await prisma.backfillRunItem.count({ where: { runId, undoneAt: null, eventId: { in: plan.deleteEventIds } } });
    if (remaining > 0) {
      if (!(await releaseLease(runId, token))) throw new LeaseLostError(runId);
      const kept = await prisma.backfillRunItem.count({ where: { runId, undoOutcome: "KEPT" } });
      return { status: "UNDOING", run: await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } }), deleted: pending.length, kept };
    }
    return await finishUndo(await prisma.backfillRun.findUniqueOrThrow({ where: { id: runId } }), plan, token, opts.by, now);
  } catch (err) {
    if (err instanceof LeaseLostError) return { status: "BUSY" };
    await releaseLease(runId, token);
    throw err;
  }
}

/**
 * Give every event the undo will touch an item, since the undo loop and its
 * finish check run on items: rows a crashed batch wrote have none. An item
 * takes its plan row by the RawEvent's fingerprint; an event no plan row
 * matches gets a negative row index, so it is still deleted and counted.
 */
async function itemizeUnrecorded(tx: Prisma.TransactionClient, run: BackfillRun, plan: UndoPlan): Promise<void> {
  const [items, raws] = await Promise.all([
    tx.backfillRunItem.findMany({ where: { runId: run.id }, select: { rowIndex: true, eventId: true } }),
    tx.rawEvent.findMany({
      where: { sourceId: run.archiveSourceId!, eventId: { in: [...plan.deleteEventIds, ...plan.keep.map((k) => k.eventId)] } },
      select: { id: true, fingerprint: true, eventId: true },
      orderBy: { id: "asc" },
    }),
  ]);
  const stored = run.plan as unknown as StoredPlan | null;
  const byFp = new Map((stored?.toWrite ?? []).map((r) => [r.fingerprint, r.index]));
  const itemized = new Set(items.map((i) => i.eventId));
  const usedRows = new Set(items.map((i) => i.rowIndex));
  let spare = Math.min(0, ...usedRows) - 1;
  const data: Prisma.BackfillRunItemCreateManyInput[] = [];
  for (const r of raws) {
    if (itemized.has(r.eventId)) continue;
    itemized.add(r.eventId);
    let rowIndex = byFp.get(r.fingerprint);
    if (rowIndex === undefined || usedRows.has(rowIndex)) rowIndex = spare--;
    usedRows.add(rowIndex);
    data.push({ runId: run.id, rowIndex, outcome: "CREATED", fingerprint: r.fingerprint, rawEventId: r.id, eventId: r.eventId });
  }
  if (data.length) await tx.backfillRunItem.createMany({ data });
}

async function finishUndo(run: BackfillRun, plan: UndoPlan, token: string, by: string, now: Date): Promise<UndoResult> {
  const kennelId = run.kennelId!;
  // UNDONE may clear the cutoff, so every planned delete must have an outcome first.
  const resolved = await prisma.backfillRunItem.findMany({
    where: { runId: run.id, undoneAt: { not: null }, eventId: { in: plan.deleteEventIds } },
    select: { eventId: true },
    distinct: ["eventId"],
  });
  if (resolved.length !== plan.deleteEventIds.length) {
    throw new Error(`Run ${run.id}: ${plan.deleteEventIds.length - resolved.length} planned deletes have no outcome`);
  }
  await recomputeCanonicalForSlots(plan.slots.map((s) => ({ kennelId: s.kennelId, date: new Date(`${s.date}T12:00:00.000Z`) })));
  await recomputeLastEventDate(kennelId);
  await refreshKennelEvidence([kennelId], now);
  const kept = await prisma.backfillRunItem.count({ where: { runId: run.id, undoOutcome: "KEPT" } });
  const deleted = await prisma.backfillRunItem.count({ where: { runId: run.id, undoOutcome: "DELETED" } });
  // Leftover RawEvents of the run on deleted events can't exist (the helper hard-deletes them);
  // any RawEvent of the archive source left on no event would be re-adopted by the merge, so remove it.
  if (kept === 0) await prisma.rawEvent.deleteMany({ where: { sourceId: run.archiveSourceId!, eventId: null } });

  const stored = run.plan as unknown as StoredPlan | null;
  const writtenDates = stored?.toWrite.map((r) => r.date) ?? []; // the plan snapshot's date set
  const keptIds = plan.keep.map((k) => k.eventId);
  const v3Changed = run.v3SnapshotHash !== null && (await v3Snapshot(kennelId, writtenDates, keptIds)) !== run.v3SnapshotHash;

  const after = await kennelStatusLine(kennelId, now);
  await prisma.$transaction(async (tx) => {
    // Clear the cutoff only if nothing was kept (10.3); otherwise it stays for the owner.
    if (kept === 0) {
      await tx.kennel.updateMany({ where: { id: kennelId, archiveCutoffRunId: run.id }, data: { archiveCutoffDate: null, archiveCutoffRunId: null } });
    }
    const moved = await tx.backfillRun.updateMany({
      where: { id: run.id, leaseToken: token },
      data: {
        status: "UNDONE",
        leaseToken: null,
        leaseExpiresAt: null,
        reasonCodes: v3Changed ? ["V3: static history changed during the undo"] : [],
        statusLines: mergeStatusLines(run.statusLines, "afterUndo", after),
      },
    });
    // Lost the lease: roll back the cutoff change too; the holder finishes the undo.
    if (moved.count !== 1) throw new LeaseLostError(run.id);
  });
  await appendStep(run.id, recordStep("undo-finish", by, now, { deleted, kept }));
  return { status: "UNDONE", run: await prisma.backfillRun.findUniqueOrThrow({ where: { id: run.id } }), deleted, kept };
}
