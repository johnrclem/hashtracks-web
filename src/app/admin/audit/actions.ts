"use server";

import { Prisma, AuditStream, AuditIssueEventType } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import { KNOWN_AUDIT_RULES, type AuditFinding } from "@/pipeline/audit-checks";
import { DASHBOARD_STREAMS } from "@/lib/audit-stream-meta";
import type {
  HarelinePromptInputs,
  RecentlyFixedItem,
  FocusAreaItem,
} from "@/lib/admin/hareline-prompt";
import {
  computeQueueSnapshotId,
  computeQueueTokenExpiresAt,
  signQueueToken,
  verifyQueueToken,
} from "@/lib/queue-snapshot-token";

/** All audit dashboard actions are admin-only — server actions are POST endpoints anyone can hit. */
async function requireAdmin(): Promise<void> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");
}

/** Encoding used for both DB suppression rows and finding lookup keys. */
function suppressionKey(kennelCode: string | null, rule: string): string {
  return `${kennelCode ?? ""}::${rule}`;
}

const TZ = "America/New_York";
const TREND_DAYS = 30;
const OFFENDER_DAYS = 14; // TODO(phase3): move to materialized aggregate when deep-dive runs land
const RECENT_RUNS_DAYS = 14;
const TOP_OFFENDERS_LIMIT = 20;

/** Bucket a date into `YYYY-MM-DD` in America/New_York. */
function easternDate(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

// ── Trends ──────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string;
  hares: number;
  title: number;
  location: number;
  event: number;
  description: number;
  total: number;
}

export async function getAuditTrends(days = TREND_DAYS): Promise<TrendPoint[]> {
  await requireAdmin();
  const rows = await prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
    select: { createdAt: true, summary: true },
    orderBy: { createdAt: "asc" },
  });

  const byDate = new Map<string, TrendPoint>();
  for (const r of rows) {
    const date = easternDate(r.createdAt);
    const summary = (r.summary ?? {}) as Record<string, number>;
    const point = byDate.get(date) ?? {
      date,
      hares: 0,
      title: 0,
      location: 0,
      event: 0,
      description: 0,
      total: 0,
    };
    point.hares += summary.hares ?? 0;
    point.title += summary.title ?? 0;
    point.location += summary.location ?? 0;
    point.event += summary.event ?? 0;
    point.description += summary.description ?? 0;
    point.total = point.hares + point.title + point.location + point.event + point.description;
    byDate.set(date, point);
  }
  return [...byDate.values()];
}

// ── Top Offenders ────────────────────────────────────────────────────

export interface TopOffender {
  kennelCode: string;
  kennelShortName: string;
  rule: string;
  category: string;
  count: number;
  lastSeen: string;
  suppressed: boolean;
}

export async function getTopOffenders(days = OFFENDER_DAYS): Promise<TopOffender[]> {
  await requireAdmin();
  // Rows are ordered desc, so the first encounter for a (kennelCode, rule) key is the most
  // recent date — used for `lastSeen` below. `count` is per-finding occurrence across runs,
  // which inflates for events that persist day-to-day; that's intentional for ranking impact.
  const [rows, suppressions] = await Promise.all([
    prisma.auditLog.findMany({
      where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
      select: { createdAt: true, findings: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.auditSuppression.findMany({ select: { kennelCode: true, rule: true } }),
  ]);

  const suppressedKeys = new Set(suppressions.map(s => suppressionKey(s.kennelCode, s.rule)));

  const map = new Map<string, TopOffender>();
  for (const r of rows) {
    const findings = (r.findings ?? []) as unknown as AuditFinding[];
    for (const f of findings) {
      const key = suppressionKey(f.kennelCode, f.rule);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, {
          kennelCode: f.kennelCode,
          kennelShortName: f.kennelShortName,
          rule: f.rule,
          category: f.category,
          count: 1,
          lastSeen: easternDate(r.createdAt),
          suppressed: suppressedKeys.has(key) || suppressedKeys.has(suppressionKey(null, f.rule)),
        });
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_OFFENDERS_LIMIT);
}

// ── Recent Runs ──────────────────────────────────────────────────────

export interface RecentRun {
  id: string;
  createdAt: Date;
  type: string;
  eventsScanned: number;
  findingsCount: number;
  groupsCount: number;
  issuesFiled: number;
}

export async function getRecentRuns(days = RECENT_RUNS_DAYS): Promise<RecentRun[]> {
  await requireAdmin();
  return prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(days) } },
    select: {
      id: true,
      createdAt: true,
      type: true,
      eventsScanned: true,
      findingsCount: true,
      groupsCount: true,
      issuesFiled: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

// ── Suppressions ─────────────────────────────────────────────────────

export interface SuppressionRow {
  id: string;
  kennelCode: string | null;
  kennelShortName: string | null;
  rule: string;
  reason: string;
  createdBy: string | null;
  createdAt: Date;
}

export async function getSuppressions(): Promise<SuppressionRow[]> {
  await requireAdmin();
  const rows = await prisma.auditSuppression.findMany({
    select: {
      id: true,
      kennelCode: true,
      rule: true,
      reason: true,
      createdBy: true,
      createdAt: true,
      kennel: { select: { shortName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(r => ({
    id: r.id,
    kennelCode: r.kennelCode,
    kennelShortName: r.kennel?.shortName ?? null,
    rule: r.rule,
    reason: r.reason,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  }));
}

export async function createSuppression(input: {
  kennelCode: string | null;
  rule: string;
  reason: string;
}): Promise<SuppressionRow> {
  const admin = await getAdminUser();
  if (!admin) throw new Error("Unauthorized");

  if (!(KNOWN_AUDIT_RULES as readonly string[]).includes(input.rule)) {
    throw new Error(`Unknown audit rule: ${input.rule}`);
  }
  if (input.reason.trim().length < 10) {
    throw new Error("Reason must be at least 10 characters");
  }

  let created;
  try {
    created = await prisma.auditSuppression.create({
      data: {
        kennelCode: input.kennelCode,
        rule: input.rule,
        reason: input.reason.trim(),
        createdBy: admin.email ?? admin.id,
      },
      select: {
        id: true,
        kennelCode: true,
        rule: true,
        reason: true,
        createdBy: true,
        createdAt: true,
        kennel: { select: { shortName: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new Error("A suppression for this kennel and rule already exists");
    }
    throw err;
  }
  return {
    id: created.id,
    kennelCode: created.kennelCode,
    kennelShortName: created.kennel?.shortName ?? null,
    rule: created.rule,
    reason: created.reason,
    createdBy: created.createdBy,
    createdAt: created.createdAt,
  };
}

export async function deleteSuppression(id: string): Promise<void> {
  await requireAdmin();
  // deleteMany is idempotent — tolerates double-clicks and already-removed rows.
  await prisma.auditSuppression.deleteMany({ where: { id } });
}

// TODO(phase3): replace JSON-blob scan with materialized aggregate (same target as getTopOffenders).
export async function getSuppressionImpact(
  kennelCode: string | null,
  rule: string,
): Promise<{ totalFindings: number; perDay: number }> {
  await requireAdmin();
  const rows = await prisma.auditLog.findMany({
    where: { type: "HARELINE", createdAt: { gte: daysAgo(OFFENDER_DAYS) } },
    select: { findings: true },
  });
  let total = 0;
  for (const r of rows) {
    const findings = (r.findings ?? []) as unknown as AuditFinding[];
    for (const f of findings) {
      if (f.rule !== rule) continue;
      if (kennelCode === null || f.kennelCode === kennelCode) total += 1;
    }
  }
  return { totalFindings: total, perDay: Math.round((total / OFFENDER_DAYS) * 10) / 10 };
}

// ── Deep Dive ────────────────────────────────────────────────────────

const ACTIVE_EVENT_WINDOW_DAYS = 90;

export interface DeepDiveSource {
  type: string;
  url: string;
  name: string;
}

export interface DeepDiveCandidate {
  kennelCode: string;
  shortName: string;
  slug: string;
  region: string;
  lastDeepDiveAt: Date | null;
  eventCount90d: number;
  sources: DeepDiveSource[];
}

/** Active kennels ranked oldest-deep-dive-first (nulls first). Active = ≥1 source + ≥1 event in last 90d. */
export async function getDeepDiveQueue(limit = 20): Promise<DeepDiveCandidate[]> {
  await requireAdmin();

  const activeSince = daysAgo(ACTIVE_EVENT_WINDOW_DAYS);

  const [kennels, lastDives] = await Promise.all([
    prisma.kennel.findMany({
      where: {
        isHidden: false,
        sources: { some: { source: { enabled: true } } },
        events: { some: { date: { gte: activeSince } } },
      },
      select: {
        kennelCode: true,
        shortName: true,
        slug: true,
        region: true,
        sources: {
          where: { source: { enabled: true } },
          select: {
            source: { select: { type: true, url: true, name: true } },
          },
        },
        _count: { select: { events: { where: { date: { gte: activeSince } } } } },
      },
    }),
    prisma.auditLog.groupBy({
      by: ["kennelCode"],
      where: { type: "KENNEL_DEEP_DIVE", kennelCode: { not: null } },
      _max: { createdAt: true },
    }),
  ]);

  const lastDiveByKennel = new Map<string, Date>();
  for (const row of lastDives) {
    if (row.kennelCode && row._max.createdAt) {
      lastDiveByKennel.set(row.kennelCode, row._max.createdAt);
    }
  }

  const candidates: DeepDiveCandidate[] = kennels.map(k => ({
    kennelCode: k.kennelCode,
    shortName: k.shortName,
    slug: k.slug,
    region: k.region,
    lastDeepDiveAt: lastDiveByKennel.get(k.kennelCode) ?? null,
    eventCount90d: k._count.events,
    sources: k.sources.map(sk => ({
      type: sk.source.type,
      url: sk.source.url,
      name: sk.source.name,
    })),
  }));

  // Sort: never-dived first, then oldest dive first
  candidates.sort((a, b) => {
    if (a.lastDeepDiveAt === null && b.lastDeepDiveAt === null) {
      return a.shortName.localeCompare(b.shortName);
    }
    if (a.lastDeepDiveAt === null) return -1;
    if (b.lastDeepDiveAt === null) return 1;
    return a.lastDeepDiveAt.getTime() - b.lastDeepDiveAt.getTime();
  });

  return candidates.slice(0, limit);
}

export async function getNextDeepDiveKennel(): Promise<DeepDiveCandidate | null> {
  const queue = await getDeepDiveQueue(1);
  return queue[0] ?? null;
}

export interface DeepDiveCoverage {
  audited: number;
  total: number;
  percent: number;
  projectedFullCycleDate: string | null;
}

/** Counts how many active kennels have at least one deep dive on record. */
export async function getDeepDiveCoverage(): Promise<DeepDiveCoverage> {
  await requireAdmin();
  const activeSince = daysAgo(ACTIVE_EVENT_WINDOW_DAYS);
  const activeWhere = {
    isHidden: false,
    sources: { some: { source: { enabled: true } } },
    events: { some: { date: { gte: activeSince } } },
  };

  const [total, audited] = await Promise.all([
    prisma.kennel.count({ where: activeWhere }),
    prisma.kennel.count({
      where: {
        ...activeWhere,
        auditLogs: { some: { type: "KENNEL_DEEP_DIVE" } },
      },
    }),
  ]);

  const percent = total > 0 ? Math.round((audited / total) * 100) : 0;
  const remaining = Math.max(0, total - audited);
  const projectedDate =
    remaining > 0
      ? new Date(Date.now() + remaining * 86_400_000).toISOString().split("T")[0]
      : null;

  return { audited, total, percent, projectedFullCycleDate: projectedDate };
}

// ── Deep-dive queue snapshot tokens (issue #1160) ───────────────────
//
// The completion dialog binds a kennel at open-time via a signed
// snapshot token; submit fails closed if the queue has shifted in a
// way that would change which kennel gets credit.

/**
 * Mint an HMAC-signed token for the deep-dive completion dialog.
 * Caller passes the kennelCode the admin clicked; we verify it's
 * actually in the current queue and return a token bound to
 * `(kennelCode, queueSnapshotId, expiresAt)`. The dialog includes
 * this token in the submit payload; `recordDeepDive` recomputes the
 * snapshot from the live queue and rejects mismatches.
 *
 * Returns null when the kennel isn't in the current queue (404
 * shape). Throws on auth failure (admin requirement).
 */
export async function getDeepDiveQueueToken(
  kennelCode: string,
): Promise<{ token: string; expiresAt: number } | null> {
  await requireAdmin();
  if (!kennelCode) return null;

  // Use the same query as `getDeepDiveQueue` for consistency, but
  // only need the kennelCode list — no event counts or sources.
  // Limit matches the dashboard's queue display so the snapshot
  // tracks what the admin actually sees.
  const queue = await getDeepDiveQueue();
  const kennelCodes = queue.map((c) => c.kennelCode);
  if (!kennelCodes.includes(kennelCode)) return null;

  const expiresAt = computeQueueTokenExpiresAt();
  const queueSnapshotId = computeQueueSnapshotId(kennelCodes);
  const token = signQueueToken({ kennelCode, queueSnapshotId, expiresAt });
  return { token, expiresAt };
}

/** Result shape for `recordDeepDive`. Discriminated union on `ok`
 *  so the dialog can branch on the failure mode (refetch token vs
 *  hard error). */
export type RecordDeepDiveResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error:
        | "invalidToken" // tampered, expired, or mismatched kennel
        | "queueChanged" // kennel still in queue but snapshot diverged
        | "kennelGone"; // kennel no longer in queue
    };

/** Record that a deep dive has been completed for a kennel. Requires
 *  a valid queue token from `getDeepDiveQueueToken` so a queue change
 *  between dialog-open and submit can't misattribute the credit
 *  (issue #1160). */
export async function recordDeepDive(input: {
  kennelCode: string;
  findingsCount: number;
  summary: string;
  /** HMAC-signed token from `getDeepDiveQueueToken`. Required. */
  queueToken: string;
}): Promise<RecordDeepDiveResult> {
  await requireAdmin();
  if (!input.kennelCode) throw new Error("kennelCode is required");
  if (input.findingsCount < 0) throw new Error("findingsCount must be ≥ 0");
  if (!input.queueToken) {
    return { ok: false, error: "invalidToken" };
  }

  const verification = verifyQueueToken(input.queueToken);
  if (
    !verification.ok ||
    verification.payload.kennelCode !== input.kennelCode
  ) {
    return { ok: false, error: "invalidToken" };
  }

  // Recompute snapshot from the live queue and decide.
  const liveQueue = await getDeepDiveQueue();
  const liveCodes = liveQueue.map((c) => c.kennelCode);
  if (!liveCodes.includes(input.kennelCode)) {
    return { ok: false, error: "kennelGone" };
  }
  const liveSnapshot = computeQueueSnapshotId(liveCodes);
  if (liveSnapshot !== verification.payload.queueSnapshotId) {
    return { ok: false, error: "queueChanged" };
  }

  const log = await prisma.auditLog.create({
    data: {
      type: "KENNEL_DEEP_DIVE",
      kennelCode: input.kennelCode,
      eventsScanned: 0,
      findingsCount: input.findingsCount,
      groupsCount: 0,
      issuesFiled: input.findingsCount,
      findings: [],
      summary: { note: input.summary },
    },
    select: { id: true },
  });
  return { ok: true, id: log.id };
}

// ── Stream Trends (audit-issue mirror) ──────────────────────────────

const STREAM_TREND_DAYS = 30;

export interface StreamDayBucket {
  opened: number;
  closed: number;
  reopened: number;
  /** Net change in open count: opened - closed + reopened. */
  net: number;
}

export type StreamTrendPoint = {
  date: string;
} & Record<AuditStream, StreamDayBucket>;

function emptyBucket(): StreamDayBucket {
  return { opened: 0, closed: 0, reopened: 0, net: 0 };
}

function emptyStreamPoint(date: string): StreamTrendPoint {
  return {
    date,
    [AuditStream.AUTOMATED]: emptyBucket(),
    [AuditStream.CHROME_EVENT]: emptyBucket(),
    [AuditStream.CHROME_KENNEL]: emptyBucket(),
    [AuditStream.UNKNOWN]: emptyBucket(),
  } as StreamTrendPoint;
}

/**
 * Daily opened/closed/reopened counts per stream over the trailing window.
 * Source of truth is AuditIssueEvent (append-only) so reopen cycles and
 * manual relabels are reflected truthfully. Returns a continuous timeline
 * (one point per calendar day) so the dashboard chart doesn't gap on
 * activity-free days.
 */
export async function getStreamTrends(days = STREAM_TREND_DAYS): Promise<StreamTrendPoint[]> {
  await requireAdmin();
  const events = await prisma.auditIssueEvent.findMany({
    where: { occurredAt: { gte: daysAgo(days) } },
    select: { type: true, stream: true, fromStream: true, occurredAt: true },
  });

  const byDate = new Map<string, StreamTrendPoint>();
  // Pre-seed every calendar day in the window so the chart has a continuous
  // x-axis even when nothing happened on a given day.
  for (let offset = days; offset >= 0; offset--) {
    const date = easternDate(daysAgo(offset));
    if (!byDate.has(date)) byDate.set(date, emptyStreamPoint(date));
  }

  for (const ev of events) {
    const date = easternDate(ev.occurredAt);
    const point = byDate.get(date) ?? emptyStreamPoint(date);
    if (!byDate.has(date)) byDate.set(date, point);

    if (ev.type === AuditIssueEventType.OPENED) {
      point[ev.stream].opened++;
    } else if (ev.type === AuditIssueEventType.CLOSED) {
      point[ev.stream].closed++;
    } else if (ev.type === AuditIssueEventType.REOPENED) {
      point[ev.stream].reopened++;
    } else if (ev.type === AuditIssueEventType.RELABELED) {
      // A relabel is a net transfer from fromStream to stream. The target
      // stream gains an "opened-equivalent" count; the source stream loses
      // one. We represent this as a synthetic +1 opened on the destination
      // and a −1 (via closed++) on the source so net math stays consistent
      // without introducing a fourth bucket field.
      point[ev.stream].opened++;
      if (ev.fromStream) point[ev.fromStream].closed++;
    }
  }

  // Recompute net per (date, stream) once per point at the end so we don't
  // do it in the hot loop.
  for (const point of byDate.values()) {
    for (const stream of DASHBOARD_STREAMS) {
      const bucket = point[stream];
      bucket.net = bucket.opened - bucket.closed + bucket.reopened;
    }
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export interface StreamOpenCounts {
  stream: AuditStream;
  /** Currently-open issue count from the AuditIssue snapshot. */
  open: number;
  /** Open count 7 days ago, computed by replaying events older than the cutoff. */
  openWeekAgo: number;
}

/**
 * Currently-open count per stream + the equivalent count from 7 days ago,
 * for the dashboard's stat-card delta arrows. Past count is computed by
 * subtracting any net-positive activity in the last 7 days from current
 * open: `openWeekAgo = open - (opened - closed + reopened) over last 7d`.
 */
export async function getOpenIssueCountsByStream(): Promise<StreamOpenCounts[]> {
  await requireAdmin();

  const [snapshot, recentEvents] = await Promise.all([
    prisma.auditIssue.groupBy({
      by: ["stream"],
      where: { state: "open", delistedAt: null },
      _count: { _all: true },
    }),
    prisma.auditIssueEvent.findMany({
      where: { occurredAt: { gte: daysAgo(7) } },
      select: { type: true, stream: true, fromStream: true },
    }),
  ]);

  // Compute the 7-day net delta per stream so we can subtract it from the
  // current snapshot to get "open count 7 days ago". OPENED/REOPENED add to
  // the destination stream; CLOSED removes from it; RELABELED both adds to
  // the destination AND removes from the source so cross-stream transfers
  // are accounted for on both sides.
  const recentDelta = new Map<AuditStream, number>();
  for (const stream of DASHBOARD_STREAMS) recentDelta.set(stream, 0);
  const bump = (stream: AuditStream, by: number) => {
    recentDelta.set(stream, (recentDelta.get(stream) ?? 0) + by);
  };
  for (const ev of recentEvents) {
    if (ev.type === AuditIssueEventType.OPENED || ev.type === AuditIssueEventType.REOPENED) {
      bump(ev.stream, +1);
    } else if (ev.type === AuditIssueEventType.CLOSED) {
      bump(ev.stream, -1);
    } else if (ev.type === AuditIssueEventType.RELABELED) {
      bump(ev.stream, +1);
      if (ev.fromStream) bump(ev.fromStream, -1);
    }
  }

  const openByStream = new Map<AuditStream, number>();
  for (const row of snapshot) openByStream.set(row.stream, row._count._all);

  return DASHBOARD_STREAMS.map((stream) => {
    const open = openByStream.get(stream) ?? 0;
    const delta = recentDelta.get(stream) ?? 0;
    return { stream, open, openWeekAgo: open - delta };
  });
}

// ── Closed-not-planned ratio (P2) ───────────────────────────────────

export interface StreamCloseReasonRatio {
  stream: AuditStream;
  /** Days of closure history this row covers. Echoed in the payload
   *  so the UI can render the window length without keeping its own
   *  hardcoded "14d" string in sync with the server constant. */
  windowDays: number;
  /** All closures in window — known + unknown. */
  closedTotal: number;
  /** Closures with `state_reason="not_planned"`. */
  closedNotPlanned: number;
  /** Closures with `closeReason IS NULL` — legacy rows the sync
   *  hasn't re-upserted yet, or rows where GitHub returned a value
   *  outside our literal union. The ratio panel shows this so
   *  operators can see when the metric is mid-rollout. */
  closedUnknown: number;
  /** 0–100 rounded over `closedTotal - closedUnknown`. Null when
   *  the known-reason denominator is below the noise floor. The
   *  unknown bucket is excluded so partially-backfilled data
   *  doesn't dilute the signal toward 0. */
  notPlannedPct: number | null;
}

const CLOSE_REASON_WINDOW_DAYS = 14;
/** Below this many *known-reason* closures the ratio noise
 *  dominates the signal. */
const RATIO_MIN_DENOMINATOR = 5;

/**
 * Fraction of recent closures per stream that GitHub recorded as
 * `state_reason="not_planned"`. A high ratio is the strongest signal
 * we have that the audit prompt over-flagged — operators close those
 * issues by picking "Close as not planned" rather than fixing them.
 *
 * `closeReason` is populated by `audit-issue-sync.ts`. Legacy rows
 * stay `null` until the next sync cycle catches them; their count is
 * surfaced via `closedUnknown` so the ratio panel can show rollout
 * state honestly.
 */
export async function getCloseReasonRatiosByStream(
  days = CLOSE_REASON_WINDOW_DAYS,
): Promise<StreamCloseReasonRatio[]> {
  await requireAdmin();

  const rows = await prisma.auditIssue.groupBy({
    by: ["stream", "closeReason"],
    where: {
      state: "closed",
      delistedAt: null,
      githubClosedAt: { gte: daysAgo(days) },
    },
    _count: { _all: true },
  });

  const totals = new Map<
    AuditStream,
    { total: number; notPlanned: number; unknown: number }
  >();
  for (const stream of DASHBOARD_STREAMS) {
    totals.set(stream, { total: 0, notPlanned: 0, unknown: 0 });
  }

  for (const row of rows) {
    const bucket = totals.get(row.stream);
    if (!bucket) continue;
    bucket.total += row._count._all;
    if (row.closeReason === "not_planned") {
      bucket.notPlanned += row._count._all;
    } else if (row.closeReason === null) {
      bucket.unknown += row._count._all;
    }
  }

  return DASHBOARD_STREAMS.map((stream) => {
    const bucket = totals.get(stream) ?? { total: 0, notPlanned: 0, unknown: 0 };
    const knownDenominator = bucket.total - bucket.unknown;
    const pct =
      knownDenominator >= RATIO_MIN_DENOMINATOR
        ? Math.round((bucket.notPlanned / knownDenominator) * 100)
        : null;
    return {
      stream,
      windowDays: days,
      closedTotal: bucket.total,
      closedNotPlanned: bucket.notPlanned,
      closedUnknown: bucket.unknown,
      notPlannedPct: pct,
    };
  });
}

export interface RecentOpenIssue {
  githubNumber: number;
  title: string;
  htmlUrl: string;
  stream: AuditStream;
  kennelCode: string | null;
  githubCreatedAt: Date;
}

/** Most-recently-opened still-open issues, grouped by stream in the panel. */
export async function getRecentOpenIssues(limit = 30): Promise<RecentOpenIssue[]> {
  await requireAdmin();
  return prisma.auditIssue.findMany({
    where: { state: "open", delistedAt: null },
    select: {
      githubNumber: true,
      title: true,
      htmlUrl: true,
      stream: true,
      kennelCode: true,
      githubCreatedAt: true,
    },
    orderBy: { githubCreatedAt: "desc" },
    take: limit,
  });
}

// ── Hareline prompt inputs (chrome-event auto-rotated sections) ─────

const HARELINE_PROMPT_WINDOW_DAYS = 14;
const HARELINE_PROMPT_LIST_LIMIT = 8;

/**
 * Fetch the dynamic inputs for `buildHarelinePrompt` — recently-closed audit
 * issues and recently-onboarded sources. Replaces the hand-curated "Recently
 * Fixed" / "Focus Areas" sections in the static prompt that decayed into
 * stale references (e.g. PR #423 from weeks ago).
 */
export async function getHarelinePromptInputs(): Promise<HarelinePromptInputs> {
  await requireAdmin();
  const since = daysAgo(HARELINE_PROMPT_WINDOW_DAYS);

  const [closedIssues, recentSources] = await Promise.all([
    prisma.auditIssue.findMany({
      where: {
        state: "closed",
        delistedAt: null,
        githubClosedAt: { gte: since },
        // Scope to the human-driven streams. Including AUTOMATED would mix
        // cron-auto-closed structural findings into a list whose readers are
        // chrome auditors looking for "fixes the team verified."
        stream: { in: [AuditStream.CHROME_EVENT, AuditStream.CHROME_KENNEL] },
        // Exclude `state_reason="not_planned"` closures — those are
        // operator-marked false positives, not fixes. Advertising them
        // as "Recently Fixed" would actively mis-teach future auditors.
        // `null` closeReason (legacy rows pre-PR #1171 that haven't
        // re-synced yet) is permitted so the list isn't empty during
        // rollout; the next sync cycle populates the field for them.
        closeReason: { not: "not_planned" },
      },
      select: { githubNumber: true, title: true, githubClosedAt: true },
      orderBy: { githubClosedAt: "desc" },
      take: HARELINE_PROMPT_LIST_LIMIT,
    }),
    prisma.source.findMany({
      where: { enabled: true, createdAt: { gte: since } },
      select: { name: true, type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: HARELINE_PROMPT_LIST_LIMIT,
    }),
  ]);

  // `githubClosedAt` is non-null at runtime (the where clause filters
  // `gte: since`), but Prisma's projected type still includes null. Filter
  // narrows it without the bare `!` assertion Sonar flagged.
  const recentlyFixed: RecentlyFixedItem[] = closedIssues
    .filter(
      (i): i is typeof i & { githubClosedAt: Date } => i.githubClosedAt !== null,
    )
    .map((i) => ({
      issueNumber: i.githubNumber,
      title: i.title,
      // easternDate keeps prompt dates in the same bucket as the rest of the dashboard.
      closedDate: easternDate(i.githubClosedAt),
    }));

  const focusAreas: FocusAreaItem[] = recentSources.map((s) => ({
    sourceName: s.name,
    sourceType: s.type,
    addedDate: easternDate(s.createdAt),
  }));

  return { recentlyFixed, focusAreas };
}
