/**
 * Backfill plan (docs/onboarding-backfill-automation-design.md 9.2, read-only
 * except for its own run row). The approval checks that need GitHub (A1–A4)
 * happen before this, in the route; this module does A5, A6 and every plan
 * guard against the database, then stores the plan.
 */
import { Prisma, type BackfillRun, type SourceType } from "@/generated/prisma/client";
import type { RawEventData } from "@/adapters/types";
import { prisma } from "@/lib/db";
import { formatYmdInTimezone } from "@/lib/timezone";
import { kennelPageEventWhere } from "@/lib/kennel-page-events";
import { prepareRowForMerge, simulateBackfillMerge } from "@/pipeline/merge";
import { CURRENT_RAW_SQL, POSTED_RUN_RAW_SQL } from "@/pipeline/kennel-evidence";
import { canonicalJson, isoDay, sha256 } from "./canonical";
import { checkDeclaredFields, compareManifest, orderedIndexes, parseArchive, type BackfillManifest, type ExpectedGap } from "./manifest";
import { scanArchiveForPii } from "./pii";
import { checkRowProvenance, websiteHosts } from "./provenance";
import { checkMigrationForBackfill } from "./migration-check";
import {
  G21_MARKER_SINCE,
  checkLiveCoverage,
  checkRowDates,
  checkRowRouting,
  checkRowShape,
  checkRunOrder,
  checkSeriesMarkerKeys,
  checkSiblingMentions,
  checkSize,
  checkStretchGap,
  touchedGuardPaths,
} from "./guards";
import { recordStep } from "./run-state";
import { parseUtcNoonDate } from "@/lib/date";
import { v3Snapshot } from "./verify";

/** Batch size of the first batch; later ones are sized from measured time (9.2). */
export const FIRST_BATCH_ROWS = 50;
/** Two applies may start per UTC day (G13, decision 8). */
export const MAX_APPLIES_PER_DAY = 2;

export interface PlannedRow {
  /** Index in the archive file. */
  index: number;
  fingerprint: string;
  date: string;
  runNumber: number | null;
  /** Expected Event.isScheduleOnly, from POSTED_RUN_RAW_SQL evaluated in the database (9.2 step 5). */
  scheduleOnly: boolean;
}

export interface StoredPlan {
  version: 1;
  splitDate: string;
  kennelTimezone: string;
  frozenAt: string;
  /** Rows before C in apply order: the run writes these. */
  toWrite: PlannedRow[];
  /** Rows from C on: left to the live feed. */
  liveOwned: number[];
  /** Curated corrections (row indexes), left out of the coverage counts. */
  corrections: number[];
  /** The manifest's declared gaps, for G20 again before the first batch. */
  expectedGaps: ExpectedGap[];
  coverage: { counted: number; present: number };
  g21: { compared: number; skipped: number };
}

export interface PlanInput {
  prNumber: number;
  manifestPath: string;
  manifestBytes: string;
  archiveBytes: string;
  /** Every path the PR changes, for G15 and A5. */
  changedFiles: readonly string[];
  /** The SQL of every migration the PR adds, for G17. */
  migrationSql: readonly string[];
  /** S, H, M from the approval check; null for a PREVIEW of an open PR. */
  mergeSha: string | null;
  stampedSha: string | null;
  mergedHeadSha: string | null;
  deployedSha: string | null;
  preview: boolean;
  startedBy: string;
  now?: Date;
}

export interface PlanOutcome {
  run: BackfillRun;
  /** Terminal problems (BLOCKED) or the reason it waits (WAITING). */
  reasons: string[];
}

/** Archive rows the merge will see: an explicit `recurringSeriesId: null` becomes an absent key (9.2 step 4). */
export function normalizeArchiveRow(row: RawEventData): RawEventData {
  const copy = structuredClone(row);
  if (copy.recurringSeriesId === null) delete copy.recurringSeriesId;
  return copy;
}

class Blocked extends Error {
  constructor(readonly reasons: string[], readonly waiting = false) {
    super(reasons.join("; "));
  }
}

function block(reasons: string[]): void {
  if (reasons.length) throw new Blocked(reasons);
}

interface Resolved {
  kennel: { id: string; kennelCode: string; regionId: string | null; archiveCutoffDate: Date | null };
  archive: { id: string; type: SourceType; trustLevel: number };
  origin: { id: string; type: SourceType; url: string; config: Prisma.JsonValue; trustLevel: number };
}

/** G4, G5 (sources), G12, G18, G19: the kennel, its archive source and its one live feed. */
async function resolveSources(manifest: BackfillManifest): Promise<Resolved> {
  const problems: string[] = [];
  if (manifest.expectedKennelCodes.length !== 1) block([`kennels: ${manifest.expectedKennelCodes.length} expected kennel codes; Phase 2 takes one`]);
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: manifest.expectedKennelCodes[0] },
    select: { id: true, kennelCode: true, regionId: true, archiveCutoffDate: true },
  });
  if (!kennel) block([`kennel: ${manifest.expectedKennelCodes[0]} doesn't exist`]);

  const archives = await prisma.source.findMany({
    where: { name: manifest.sourceName },
    select: { id: true, type: true, trustLevel: true, enabled: true, archiveOnly: true, replacedById: true, kennels: { select: { kennelId: true } } },
  });
  if (archives.length !== 1) block([`G12: ${archives.length} sources named "${manifest.sourceName}"`]);
  const archive = archives[0];
  if (!archive.archiveOnly || archive.enabled || archive.replacedById) problems.push("G12: the archive source must be disabled, archiveOnly and not replaced");
  if (archive.kennels.length !== 1 || archive.kennels[0].kennelId !== kennel!.id) problems.push("G4: the archive source must be linked to the kennel and nothing else");

  const origins = await prisma.source.findMany({
    where: { name: manifest.originSourceName },
    select: { id: true, type: true, url: true, config: true, trustLevel: true, enabled: true, kennels: { select: { kennelId: true } } },
  });
  if (origins.length !== 1) block([`G5: ${origins.length} sources named "${manifest.originSourceName}"`]);
  const origin = origins[0];
  if (archive.type !== origin.type) problems.push("G12: the archive source's type must be the origin's");
  if (archive.trustLevel > origin.trustLevel) problems.push("G12: the archive source's trust may not exceed the origin's");
  if (origin.kennels.length !== 1 || origin.kennels[0].kennelId !== kennel!.id) problems.push("G5: the origin must be linked to the kennel only");
  const cfg = (origin.config ?? {}) as { kennelPatterns?: unknown; defaultKennelTag?: unknown };
  const patternCodes = JSON.stringify(cfg.kennelPatterns ?? []).match(/"[a-z0-9-]+"/g) ?? [];
  const namesOther =
    (typeof cfg.defaultKennelTag === "string" && cfg.defaultKennelTag !== kennel!.kennelCode) ||
    (Array.isArray(cfg.kennelPatterns) && cfg.kennelPatterns.length > 0 && patternCodes.some((c) => c !== `"${kennel!.kennelCode}"`));
  if (namesOther) problems.push("G5: the origin's kennelPatterns or defaultKennelTag route to another kennel");

  const linked = await prisma.sourceKennel.findMany({
    where: { kennelId: kennel!.id },
    select: { source: { select: { id: true, enabled: true } } },
  });
  const enabled = linked.filter((l) => l.source.enabled).map((l) => l.source.id);
  if (enabled.length !== 1 || enabled[0] !== origin.id || !origin.enabled) problems.push(`G18: the kennel must have exactly one enabled source, the origin (has ${enabled.length})`);

  if (kennel!.archiveCutoffDate) problems.push("G19: the kennel already has an archive cutoff");
  const earlier = await prisma.backfillRun.count({
    where: { kennelId: kennel!.id, status: { in: ["PLANNED", "APPLYING", "HALTED", "APPLIED", "VERIFIED", "VERIFY_FAILED", "UNDOING"] } },
  });
  if (earlier > 0) problems.push("G19: another run for this kennel is planned or has written rows");

  block(problems);
  return { kennel: kennel!, archive, origin };
}

/** C: the earliest date before today of an event of the kennel backed by the origin (6.5). */
export async function findSplitDate(kennelId: string, originId: string, today: string): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ c: Date | null }>>`
    SELECT MIN(e."date") AS c
    FROM "Event" e
    JOIN "RawEvent" r ON r."eventId" = e.id
    WHERE e."kennelId" = ${kennelId} AND r."sourceId" = ${originId} AND e."date" < ${parseUtcNoonDate(today)}
  `;
  return rows[0]?.c ? isoDay(rows[0].c) : null;
}

/** 9.2 step 5: each row's expected isScheduleOnly, evaluated by POSTED_RUN_RAW_SQL itself. */
async function expectedScheduleOnly(rows: ReadonlyArray<{ i: number; d: RawEventData }>, type: SourceType): Promise<Map<number, boolean>> {
  if (rows.length === 0) return new Map();
  const result = await prisma.$queryRaw<Array<{ idx: number; posted: boolean }>>`
    SELECT r.idx, ${POSTED_RUN_RAW_SQL} AS posted
    FROM (
      SELECT (x->>'i')::int AS idx, x->'d' AS "rawData"
      FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS x
    ) r
    CROSS JOIN (SELECT ${type}::"SourceType" AS type) s
  `;
  return new Map(result.map((r) => [Number(r.idx), !r.posted]));
}

function kennelEventWhere(kennelId: string, excludeSourceId?: string): Prisma.EventWhereInput {
  return {
    OR: [{ kennelId }, { eventKennels: { some: { kennelId } } }],
    ...(excludeSourceId ? { rawEvents: { none: { sourceId: excludeSourceId } } } : {}),
  };
}

/**
 * G9: dates (of `dates`) on which any event, in any status, has the kennel as
 * primary or co-host. `excludeSourceId` leaves out the run's own archive events.
 */
export async function occupiedDates(kennelId: string, dates: readonly string[], excludeSourceId?: string): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const events = await prisma.event.findMany({
    where: { AND: [kennelEventWhere(kennelId, excludeSourceId), { date: { in: dates.map(parseUtcNoonDate) } }] },
    select: { date: true },
  });
  return new Set(events.map((e) => isoDay(e.date)));
}

export async function occupiedDateCount(kennelId: string, dates: readonly string[], excludeSourceId?: string): Promise<number> {
  return (await occupiedDates(kennelId, dates, excludeSourceId)).size;
}

/** G7 (existing): which of `runNumbers` an existing event of the kennel already has. */
export async function existingRunNumbers(kennelId: string, runNumbers: readonly number[], excludeSourceId?: string): Promise<Set<number>> {
  if (runNumbers.length === 0) return new Set();
  const events = await prisma.event.findMany({
    where: { AND: [kennelEventWhere(kennelId, excludeSourceId), { runNumber: { in: [...new Set(runNumbers)] } }] },
    select: { runNumber: true },
  });
  return new Set(events.map((e) => e.runNumber!));
}

/** G6: other kennels of the same region, with their names. */
async function regionSiblings(kennel: Resolved["kennel"]) {
  if (!kennel.regionId) return [];
  const siblings = await prisma.kennel.findMany({
    where: { regionId: kennel.regionId, id: { not: kennel.id } },
    select: { kennelCode: true, shortName: true, aliases: { select: { alias: true } } },
  });
  return siblings.map((s) => ({ kennelCode: s.kennelCode, names: [s.kennelCode, s.shortName, ...s.aliases.map((a) => a.alias)] }));
}

/** G5 shared-host input: website hosts of sources linked to any other kennel. */
async function otherKennelHosts(kennelId: string): Promise<Set<string>> {
  const sources = await prisma.source.findMany({
    where: { kennels: { some: { kennelId: { not: kennelId } } } },
    select: { url: true },
  });
  return websiteHosts(sources.map((s) => s.url));
}

/** The kennel's displayed events as `date#run` keys (G20 coverage, V2). */
export async function displayedRunKeys(kennelId: string, ignoreStop = false): Promise<Set<string>> {
  const events = await prisma.event.findMany({
    where: kennelPageEventWhere(kennelId, { ignoreStop }),
    select: { date: true, runNumber: true },
  });
  return new Set(events.filter((e) => e.runNumber != null).map((e) => `${isoDay(e.date)}#${e.runNumber}`));
}

/**
 * G21 (overlap): each archive row from C to frozenAt agrees on the series marker
 * with the origin's current RawEvent for the same sourceUrl on the kennel's
 * event that date. Rows with no current copy, corrected rows and copies stored
 * before the marker existed are skipped.
 */
async function checkSeriesMarkerOverlap(
  rows: ReadonlyArray<{ index: number; row: RawEventData }>,
  kennelId: string,
  originId: string,
): Promise<{ compared: number; skipped: number; mismatches: number[] }> {
  const withUrl = rows.filter((r) => r.row.sourceUrl);
  const copies = withUrl.length
    ? await prisma.$queryRaw<Array<{ idx: number; marker: string | null }>>`
        SELECT x.idx, r."rawData"->>'recurringSeriesId' AS marker
        FROM (
          SELECT (v->>'i')::int AS idx, (v->>'d')::date AS d, v->>'u' AS u
          FROM jsonb_array_elements(${JSON.stringify(withUrl.map((r) => ({ i: r.index, d: r.row.date, u: r.row.sourceUrl })))}::jsonb) AS v
        ) x
        JOIN "Event" e ON e."kennelId" = ${kennelId} AND e."date" = (x.d + time '12:00')
        JOIN "RawEvent" r ON r."eventId" = e.id
        WHERE r."sourceId" = ${originId}
          AND r."rawData"->>'sourceUrl' = x.u
          AND r."scrapedAt" >= ${G21_MARKER_SINCE}
          AND ${CURRENT_RAW_SQL}
      `
    : [];
  const byRow = new Map<number, Array<string | null>>();
  for (const c of copies) byRow.set(Number(c.idx), [...(byRow.get(Number(c.idx)) ?? []), c.marker || null]);
  const mismatches: number[] = [];
  for (const { index, row } of withUrl) {
    const markers = byRow.get(index);
    if (markers?.some((m) => m !== (row.recurringSeriesId || null))) mismatches.push(index);
  }
  return { compared: byRow.size, skipped: rows.length - byRow.size, mismatches };
}

/** planHash: approval hash, source ids, kennel id, C, and the ordered fingerprints and flags to write (9.2 step 8). */
export function computePlanHash(approvalHash: string, r: Resolved, plan: StoredPlan): string {
  return sha256(
    canonicalJson({
      approvalHash,
      archiveSourceId: r.archive.id,
      originSourceId: r.origin.id,
      kennelId: r.kennel.id,
      splitDate: plan.splitDate,
      rows: plan.toWrite.map((p) => [p.fingerprint, p.scheduleOnly]),
    }),
  );
}

/**
 * Plan a backfill: A5, A6 and every plan guard, then store the run. Returns an
 * existing non-preview run for the same manifest instead of planning again
 * (10.1). Writes only the run row.
 */
export async function planBackfill(input: PlanInput): Promise<PlanOutcome> {
  const now = input.now ?? new Date();
  const manifestSha256 = sha256(input.manifestBytes);
  let waiting: BackfillRun | null = null;
  if (!input.preview) {
    const existing = await prisma.backfillRun.findFirst({ where: { manifestSha256, status: { not: "PREVIEW" } } });
    // A WAITING run is planned again in place (6.7: the watch cron retries it); any other is final (10.1).
    if (existing && existing.status !== "WAITING") return { run: existing, reasons: existing.reasonCodes };
    waiting = existing;
  }

  let manifest: BackfillManifest;
  try {
    manifest = JSON.parse(input.manifestBytes) as BackfillManifest;
  } catch {
    return storeTerminal(input, manifestSha256, null, ["G2: the manifest isn't valid JSON"]);
  }

  try {
    const plan = await computePlan(input, manifest, now);
    const status = input.preview ? "PREVIEW" : manifest.binding === "adopt-only" ? "ADOPTED" : "PLANNED";
    if (waiting) await prisma.backfillRun.delete({ where: { id: waiting.id } });
    const run = await prisma.backfillRun.create({
      data: {
        ...runIdentity(input, manifest, manifestSha256),
        status,
        planHash: plan.planHash,
        archiveSourceId: plan.resolved.archive.id,
        originSourceId: plan.resolved.origin.id,
        kennelId: plan.resolved.kennel.id,
        splitDate: plan.stored ? parseUtcNoonDate(plan.stored.splitDate) : null,
        plan: plan.stored ? (plan.stored as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        counts: plan.counts as unknown as Prisma.InputJsonValue,
        v3SnapshotHash: plan.v3,
        plannedOnSha: input.deployedSha,
        stepLog: [recordStep("plan", input.startedBy, now)] as unknown as Prisma.InputJsonValue,
        ...(plan.adopted.length
          ? { items: { create: plan.adopted.map((a) => ({ rowIndex: a.index, outcome: "ADOPTED" as const, eventId: a.eventId })) } }
          : {}),
      },
    });
    return { run, reasons: [] };
  } catch (err) {
    if (!(err instanceof Blocked)) throw err;
    if (waiting) {
      const run = await prisma.backfillRun.update({
        where: { id: waiting.id },
        data: { status: err.waiting ? "WAITING" : "BLOCKED", reasonCodes: err.reasons },
      });
      return { run, reasons: err.reasons };
    }
    return storeTerminal(input, manifestSha256, manifest, err.reasons, err.waiting);
  }
}

function runIdentity(input: PlanInput, manifest: BackfillManifest | null, manifestSha256: string) {
  return {
    prNumber: input.prNumber,
    mergeSha: input.mergeSha,
    stampedSha: input.stampedSha,
    mergedHeadSha: input.mergedHeadSha,
    manifestPath: input.manifestPath,
    manifestSha256,
    archiveSha256: sha256(input.archiveBytes),
    approvalHash: manifest?.approvalHash ?? "",
    binding: manifest?.binding === "adopt-only" ? ("ADOPT_ONLY" as const) : ("ARCHIVE_SOURCE" as const),
  };
}

async function storeTerminal(
  input: PlanInput,
  manifestSha256: string,
  manifest: BackfillManifest | null,
  reasons: string[],
  waiting = false,
): Promise<PlanOutcome> {
  const now = input.now ?? new Date();
  const run = await prisma.backfillRun.create({
    data: {
      ...runIdentity(input, manifest, manifestSha256),
      // A preview never blocks the manifest (the unique index skips PREVIEW).
      status: input.preview ? "PREVIEW" : waiting ? "WAITING" : "BLOCKED",
      reasonCodes: reasons,
      stepLog: [recordStep("plan", input.startedBy, now)] as unknown as Prisma.InputJsonValue,
    },
  });
  return { run, reasons };
}

interface ComputedPlan {
  resolved: Resolved;
  stored: StoredPlan | null;
  planHash: string | null;
  counts: Record<string, number>;
  v3: string | null;
  adopted: Array<{ index: number; eventId: string }>;
}

async function computePlan(input: PlanInput, manifest: BackfillManifest, now: Date): Promise<ComputedPlan> {
  // 1. A5, A6, G2, G21 key check.
  const manifests = input.changedFiles.filter((f) => /^scripts\/data\/[a-z0-9-]+-history[a-z0-9-]*\.manifest\.json$/.test(f));
  block(manifests.length === 1 && manifests[0] === input.manifestPath ? [] : ["A5: the PR must carry exactly this one manifest"]);
  block(touchedGuardPaths(input.changedFiles).map((p) => `G15: the PR changes guard path ${p}`));
  for (const sql of input.migrationSql) block((await checkMigrationForBackfill(sql)).map((p) => `G17: ${p}`));
  let rawRows: RawEventData[];
  try {
    rawRows = parseArchive(input.archiveBytes);
  } catch (err) {
    block([`G2: ${err instanceof Error ? err.message : String(err)}`]);
    throw err;
  }
  block(compareManifest(manifest, input.archiveBytes).map((p) => `G2: ${p.detail}`));
  block(checkDeclaredFields(manifest, rawRows).map((p) => `G2: ${p.detail}`));
  block(checkSize(rawRows.length));
  block(manifest.piiScan.residual !== 0 || scanArchiveForPii(rawRows).length > 0 ? ["G8: the archive contains phone numbers or email addresses"] : []);

  if (manifest.binding === "adopt-only") return adopt(manifest, rawRows, await resolveForAdoption(manifest));

  // 2. Sources.
  const resolved = await resolveSources(manifest);
  const { kennel, archive, origin } = resolved;
  if (origin.type === "GOOGLE_CALENDAR") {
    const missing = checkSeriesMarkerKeys(rawRows);
    block(missing.length ? [`G21: ${missing.length} rows lack the recurringSeriesId key`] : []);
  }
  block(checkRowRouting(rawRows, kennel.kennelCode).length ? ["G4: every row must carry exactly the expected kennel code"] : []);
  block(checkRowShape(rawRows).length ? ["section 3: rows with seriesId or externalLinks"] : []);
  const today = formatYmdInTimezone(now, manifest.kennelTimezone);
  const badDates = checkRowDates(rawRows, today, manifest.frozenAt);
  block(badDates.length ? [`G3: ${badDates.length} rows are not dated before today and frozenAt`] : []);

  const provenance = checkRowProvenance(origin, rawRows.map((r) => r.sourceUrl), await otherKennelHosts(kennel.id));
  if (!provenance.ok) block([provenance.supervised ? `G5: ${provenance.reason}` : `G5: ${provenance.failures.length} rows' sourceUrl doesn't prove the origin`]);
  block(checkRunOrder(rawRows).map((p) => `G7: ${p}`));
  const sibling = checkSiblingMentions(rawRows, await regionSiblings(kennel));
  block(sibling.length ? [`G6: ${sibling.length} rows name another kennel of the region`] : []);

  // 3. The split point and G20.
  const splitDate = await findSplitDate(kennel.id, origin.id, today);
  if (!splitDate) throw new Blocked(["WAITING: the origin backs no past event yet"], true);
  const order = orderedIndexes(rawRows);
  const before = order.filter((i) => rawRows[i].date < splitDate);
  const liveOwned = order.filter((i) => rawRows[i].date >= splitDate);
  const corrections = new Set(manifest.curatedCorrections.map((c) => c.row));
  block(checkStretchGap(order.map((i) => rawRows[i].date), splitDate, manifest.expectedGaps).map((p) => `G20: ${p}`));
  const coverage = checkLiveCoverage(
    liveOwned.map((i) => ({ index: i, date: rawRows[i].date, runNumber: rawRows[i].runNumber })),
    corrections,
    await displayedRunKeys(kennel.id),
  );
  block(coverage.problems.map((p) => `G20: ${p}`));

  // 4–5. Normalise as the merge will, fingerprint, and evaluate the posted-run rule in SQL.
  const prepared = before.map((i) => ({ i, ...prepareRowForMerge(normalizeArchiveRow(rawRows[i])) }));
  const flags = await expectedScheduleOnly(prepared.map((p) => ({ i: p.i, d: p.event })), archive.type);

  // 6. G9, G7 (existing), G11, G13 (rate), G21 overlap, G10.
  const occupied = await occupiedDates(kennel.id, [...new Set(before.map((i) => rawRows[i].date))]);
  block(occupied.size ? [`G9: ${before.filter((i) => occupied.has(rawRows[i].date)).length} rows fall on dates that already have an event of the kennel`] : []);
  const taken = await existingRunNumbers(kennel.id, before.map((i) => rawRows[i].runNumber).filter((n): n is number => n != null));
  block(taken.size ? [`G7: ${taken.size} run numbers before the split point already exist on the kennel's events`] : []);
  block(before.length + liveOwned.length === rawRows.length ? [] : ["G11: rows before and from the split point don't add up"]);
  let overlap: { compared: number; skipped: number; mismatches: number[] } = { compared: 0, skipped: 0, mismatches: [] };
  if (origin.type === "GOOGLE_CALENDAR") {
    overlap = await checkSeriesMarkerOverlap(liveOwned.filter((i) => !corrections.has(i)).map((i) => ({ index: i, row: rawRows[i] })), kennel.id, origin.id);
    block(overlap.mismatches.length ? [`G21: ${overlap.mismatches.length} rows disagree with the origin on the series marker`] : []);
  }
  const sim = await simulateBackfillMerge(archive.id, before.map((i) => normalizeArchiveRow(rawRows[i])));
  const notCreate = sim.rows.filter((r) => r.outcome !== "CREATE");
  block(notCreate.length ? [`G10: ${notCreate.length} rows would not be a clean create (${[...new Set(notCreate.map((r) => (r.outcome === "MATCH" ? r.path : r.reason)))].join(", ")})`] : []);
  block(sim.canonicalChangeSlots.length ? [`G10: the canonical recompute would change ${sim.canonicalChangeSlots.length} slots`] : []);
  block(sim.rows.length === before.length ? [] : ["G11: the simulation saw a different number of rows"]);

  const stored: StoredPlan = {
    version: 1,
    splitDate,
    kennelTimezone: manifest.kennelTimezone,
    frozenAt: manifest.frozenAt,
    toWrite: prepared.map((p) => ({
      index: p.i,
      fingerprint: p.fingerprint,
      date: rawRows[p.i].date,
      runNumber: rawRows[p.i].runNumber ?? null,
      scheduleOnly: flags.get(p.i) ?? false,
    })),
    liveOwned,
    corrections: [...corrections],
    expectedGaps: manifest.expectedGaps,
    coverage: { counted: coverage.counted, present: coverage.present },
    g21: { compared: overlap.compared, skipped: overlap.skipped },
  };
  const v3 = await v3Snapshot(kennel.id, stored.toWrite.map((r) => r.date), []);
  return {
    resolved,
    stored,
    planHash: computePlanHash(manifest.approvalHash, resolved, stored),
    counts: { rows: rawRows.length, beforeSplit: before.length, fromSplit: liveOwned.length, scheduleOnly: stored.toWrite.filter((r) => r.scheduleOnly).length },
    v3,
    adopted: [],
  };
}

/** Adoption needs only the kennel and the source the rows were applied to (6.6). */
async function resolveForAdoption(manifest: BackfillManifest): Promise<Resolved> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: manifest.expectedKennelCodes[0] ?? "" },
    select: { id: true, kennelCode: true, regionId: true, archiveCutoffDate: true },
  });
  const sources = await prisma.source.findMany({
    where: { name: { in: [manifest.sourceName, manifest.originSourceName] } },
    select: { id: true, name: true, type: true, url: true, config: true, trustLevel: true },
  });
  const applied = sources.filter((s) => s.name === manifest.sourceName);
  const origin = sources.filter((s) => s.name === manifest.originSourceName);
  if (!kennel || applied.length !== 1 || origin.length !== 1) block(["adopt: the kennel, the applied source and the origin must each exist once"]);
  return { kennel: kennel!, archive: applied[0], origin: origin[0] };
}

/**
 * Adoption (6.6): every row must match an event of the kennel on its date with
 * its run number (or, unnumbered, the only event that date) backed by the
 * manifest's source. Writes nothing beyond the run and its items.
 */
async function adopt(manifest: BackfillManifest, rows: RawEventData[], resolved: Resolved): Promise<ComputedPlan> {
  const events = await prisma.event.findMany({
    where: {
      kennelId: resolved.kennel.id,
      date: { in: [...new Set(rows.map((r) => r.date))].map(parseUtcNoonDate) },
      rawEvents: { some: { sourceId: resolved.archive.id } },
    },
    select: { id: true, date: true, runNumber: true },
  });
  const byDate = new Map<string, Array<{ id: string; runNumber: number | null }>>();
  for (const e of events) byDate.set(isoDay(e.date), [...(byDate.get(isoDay(e.date)) ?? []), e]);
  const adopted: Array<{ index: number; eventId: string }> = [];
  const missing: number[] = [];
  rows.forEach((r, index) => {
    const onDate = byDate.get(r.date) ?? [];
    const hit = r.runNumber != null ? onDate.find((e) => e.runNumber === r.runNumber) : onDate.length === 1 ? onDate[0] : undefined;
    if (hit) adopted.push({ index, eventId: hit.id });
    else missing.push(index);
  });
  block(missing.length ? [`adopt: ${missing.length} rows have no matching event backed by "${manifest.sourceName}"`] : []);
  return { resolved, stored: null, planHash: null, counts: { rows: rows.length, adopted: adopted.length }, v3: null, adopted };
}
