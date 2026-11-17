/**
 * Backfill verification (docs/onboarding-backfill-automation-design.md 9.3).
 * Row checks, not totals: V1–V4 here; V5 (the public page's own count) is
 * checked by the route, which can fetch the page.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { kennelPageEventWhere } from "@/lib/kennel-page-events";
import { POSTED_RUN_RAW_SQL } from "@/pipeline/kennel-evidence";
import { canonicalJson, isoDay, sha256 } from "./canonical";
import { checkLiveCoverage } from "./guards";
import type { StoredPlan } from "./plan";
import { parseUtcNoonDate } from "@/lib/date";

const V3_WINDOW_MS = 30 * 86_400_000;

/**
 * V3: a hash over every event of the kennel dated within 30 days of a written
 * row's date that no enabled source backs, leaving out the run's own events.
 * Live-backed events are left out: their sources update them every day.
 */
export async function v3Snapshot(kennelId: string, writtenDates: readonly string[], runEventIds: readonly string[]): Promise<string> {
  if (writtenDates.length === 0) return sha256("[]");
  const times = [...new Set(writtenDates)].map((d) => parseUtcNoonDate(d).getTime()).sort((a, b) => a - b);
  const events = await prisma.event.findMany({
    where: {
      kennelId,
      date: { gte: new Date(times[0] - V3_WINDOW_MS), lte: new Date(times.at(-1)! + V3_WINDOW_MS) },
      id: { notIn: [...runEventIds] },
      rawEvents: { none: { source: { enabled: true } } },
    },
    select: {
      id: true, date: true, status: true, isCanonical: true, kennelId: true, runNumber: true, title: true,
      haresText: true, locationName: true, locationStreet: true, locationCity: true, locationAddress: true, parentEventId: true,
    },
    orderBy: { id: "asc" },
  });
  const near = events.filter((e) => times.some((t) => Math.abs(e.date.getTime() - t) <= V3_WINDOW_MS));
  return sha256(canonicalJson(near.map((e) => ({ ...e, date: isoDay(e.date) }))));
}

/** V4: written (kennel, date) slots that show any displayed event other than the run's own. */
export async function v4Intruders(kennelId: string, writtenDates: readonly string[], runEventIds: readonly string[]): Promise<string[]> {
  if (writtenDates.length === 0) return [];
  const others = await prisma.event.findMany({
    where: {
      AND: [kennelPageEventWhere(kennelId, { ignoreStop: true }), { date: { in: [...new Set(writtenDates)].map(parseUtcNoonDate) }, id: { notIn: [...runEventIds] } }],
    },
    select: { date: true },
  });
  return [...new Set(others.map((e) => isoDay(e.date)))];
}

export interface VerificationResult {
  ok: boolean;
  checkedAt: string;
  /** Row indexes failing each check. */
  failures: { V1: number[]; V2: number[]; V3: boolean; V4: string[] };
  /** Rows whose flag matched a changed rule rather than the plan (V1), and rows a stop hides (excused). */
  notes: { ruleChanged: number[]; hiddenByStop: number[] };
  coverage: { counted: number; present: number; missing: number[] };
  /** Rows → written → visible → unique dates: informational, never pass or fail (9.3). */
  counts: { rows: number; written: number; visible: number; uniqueDates: number };
}

/**
 * Run V1–V4 for a run's CREATED items against its stored plan. Read-only.
 * `deployedSha` lets V1 record a changed posted-run rule as a note.
 */
export async function verifyRows(args: {
  runId: string;
  kennelId: string;
  plan: StoredPlan;
  plannedOnSha: string | null;
  deployedSha: string | null;
  v3SnapshotHash: string | null;
  liveRows: ReadonlyArray<{ index: number; date: string; runNumber: number | null | undefined }>;
  now?: Date;
}): Promise<VerificationResult> {
  const { kennelId, plan } = args;
  const items = await prisma.backfillRunItem.findMany({
    where: { runId: args.runId, outcome: "CREATED", undoneAt: null },
    select: { rowIndex: true, eventId: true, rawEventId: true, fingerprint: true },
  });
  const planByIndex = new Map(plan.toWrite.map((r) => [r.index, r]));
  const runEventIds = items.map((i) => i.eventId).filter((id): id is string => !!id);
  const kennel = await prisma.kennel.findUnique({ where: { id: kennelId }, select: { stoppedAt: true } });
  const stopped = !!kennel?.stoppedAt;

  const events = await prisma.event.findMany({
    where: { id: { in: runEventIds } },
    select: { id: true, date: true, runNumber: true, status: true, isCanonical: true, kennelId: true, isScheduleOnly: true },
  });
  const eventById = new Map(events.map((e) => [e.id, e]));
  const visibleIds = new Set(
    (await prisma.event.findMany({ where: { AND: [kennelPageEventWhere(kennelId), { id: { in: runEventIds } }] }, select: { id: true } })).map((e) => e.id),
  );
  const visibleIgnoringStop = new Set(
    (await prisma.event.findMany({ where: { AND: [kennelPageEventWhere(kennelId, { ignoreStop: true }), { id: { in: runEventIds } }] }, select: { id: true } })).map((e) => e.id),
  );

  // Every planned row must have its CREATED item: a row never written fails V1.
  const itemized = new Set(items.map((i) => i.rowIndex));
  const v1: number[] = plan.toWrite.filter((r) => !itemized.has(r.index)).map((r) => r.index);
  const ruleChanged: number[] = [];
  const hiddenByStop: number[] = [];
  for (const item of items) {
    const planned = planByIndex.get(item.rowIndex);
    const e = item.eventId ? eventById.get(item.eventId) : undefined;
    if (!planned || !e || e.status !== "CONFIRMED" || !e.isCanonical || e.kennelId !== kennelId || isoDay(e.date) !== planned.date) {
      v1.push(item.rowIndex);
      continue;
    }
    const excused = stopped && planned.scheduleOnly;
    if (!visibleIds.has(e.id)) {
      if (excused && visibleIgnoringStop.has(e.id)) hiddenByStop.push(item.rowIndex);
      else {
        v1.push(item.rowIndex);
        continue;
      }
    }
    if (e.isScheduleOnly !== planned.scheduleOnly) {
      if (await flagMatchesChangedRule(item.rawEventId, planned.fingerprint, e.isScheduleOnly, args.plannedOnSha, args.deployedSha)) ruleChanged.push(item.rowIndex);
      else v1.push(item.rowIndex);
    }
  }

  // V2: every written (date, run) is displayed; 95% of the live stretch too.
  const displayed = new Set(
    (await prisma.event.findMany({ where: kennelPageEventWhere(kennelId, { ignoreStop: stopped }), select: { date: true, runNumber: true } }))
      .filter((e) => e.runNumber != null)
      .map((e) => `${isoDay(e.date)}#${e.runNumber}`),
  );
  const v2 = items
    .map((i) => planByIndex.get(i.rowIndex))
    .filter((p): p is NonNullable<typeof p> => !!p && p.runNumber != null && !displayed.has(`${p.date}#${p.runNumber}`))
    .map((p) => p.index);
  const coverage = checkLiveCoverage(args.liveRows, new Set(plan.corrections), displayed);

  const writtenDates = items.map((i) => planByIndex.get(i.rowIndex)?.date).filter((d): d is string => !!d);
  // The same date set as the plan's snapshot, so a later row's neighbourhood is always covered.
  const v3 = args.v3SnapshotHash !== null && (await v3Snapshot(kennelId, plan.toWrite.map((r) => r.date), runEventIds)) !== args.v3SnapshotHash;
  const v4 = await v4Intruders(kennelId, writtenDates, runEventIds);

  const ok = v1.length === 0 && v2.length === 0 && !v3 && v4.length === 0 && coverage.problems.length === 0;
  return {
    ok,
    checkedAt: (args.now ?? new Date()).toISOString(),
    failures: { V1: v1, V2: v2, V3: v3, V4: v4 },
    notes: { ruleChanged, hiddenByStop },
    coverage: { counted: coverage.counted, present: coverage.present, missing: coverage.missing },
    counts: { rows: plan.toWrite.length + plan.liveOwned.length, written: items.length, visible: visibleIds.size, uniqueDates: new Set(writtenDates).size },
  };
}

/**
 * V1's "rule changed" note: the deploy differs from the plan's, the stored
 * RawEvent is the planned one, and the flag equals the rule re-run on it now.
 */
async function flagMatchesChangedRule(
  rawEventId: string | null,
  plannedFingerprint: string,
  flag: boolean,
  plannedOnSha: string | null,
  deployedSha: string | null,
): Promise<boolean> {
  if (!rawEventId || !deployedSha || deployedSha === plannedOnSha) return false;
  const rows = await prisma.$queryRaw<Array<{ fingerprint: string; posted: boolean }>>(Prisma.sql`
    SELECT r.fingerprint, ${POSTED_RUN_RAW_SQL} AS posted
    FROM "RawEvent" r JOIN "Source" s ON s.id = r."sourceId"
    WHERE r.id = ${rawEventId}
  `);
  return rows.length === 1 && rows[0].fingerprint === plannedFingerprint && !rows[0].posted === flag;
}
