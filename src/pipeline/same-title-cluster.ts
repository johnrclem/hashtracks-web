/**
 * Same-title consecutive-day cluster linker (refs #1560 audit bucket A.5).
 *
 * Many kennels publish their multi-day events as N separate same-titled
 * trails on consecutive days without any series metadata — InterScandi
 * 2026 Oslo (OH3 × 4 days), BMPH3 Belgian Nash Hash (× 3 days), IndyScent
 * NASH Hash (× 4 days). The audit (#1718) catches these in bucket A.5;
 * this linker fixes them in the pipeline so the UI renders one umbrella
 * card with a date-range pill + "+ N trails" badge instead of N separate
 * top-level rows.
 *
 * Linker contract:
 *   - Within-kennel only. The query scopes by `kennelId IN linkedKennelIds`
 *     (the source's linked kennels) but does NOT restrict by source — so
 *     a kennel that publishes the same series across both Google Calendar
 *     AND an HTML scraper will get the events linked together. That's
 *     intentional: it generalizes the same-title heuristic to multi-source
 *     kennels at zero extra implementation cost. Cross-KENNEL clusters
 *     (e.g. Boston Marathon week where each day has a different host
 *     kennel) need a shared identifier and are PR J (B.1) territory.
 *   - Promotes the EARLIEST event in the cluster to series parent
 *     (`isSeriesParent=true`, `endDate=lastDate`). Sets `parentEventId`
 *     on the others.
 *   - All-or-nothing: parent + children writes happen inside a single
 *     `$transaction` so a partial-link state can't be left behind on
 *     a write failure (Codex P1 review on PR #1742). Without that, a
 *     half-linked cluster would be PERMANENTLY skipped by future runs
 *     because the "any member already linked" gate considers the
 *     half-applied parent as "already linked".
 *   - Title rewriting is OUT OF SCOPE for this PR — the umbrella keeps
 *     the earliest event's title verbatim. PR K (title normalization)
 *     will handle synthetic umbrella names, possibly via AI per a user
 *     discussion in PR #1742.
 *   - Idempotent: clusters whose members are ALREADY linked (any member
 *     has `isSeriesParent=true` OR `parentEventId!=null`) skip cleanly.
 *
 * The linker is invoked at the end of `processRawEvents` after the
 * adapter-driven `linkMultiDaySeries` so adapter-emitted `seriesId`
 * groups always win — this linker only acts on the residue.
 */

import type { PrismaClient } from "@/generated/prisma/client";

/** Public for tests + the audit script (so both use the same group key). */
export function normalizeTitleForCluster(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[#\-–—:]/g, " ")
    .replaceAll(/\btrail\b/g, "")
    .replaceAll(/\b\d+\b/g, "") // strip standalone run numbers + year suffixes
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * Group key for cluster matching = first 4 tokens of the normalized title.
 * Per-day suffixes ("Pub Crawl!", "Hangover Trail!") differ across days but
 * the leading event-name tokens stay stable. Example:
 *   "BMPH3: Trail #2051 – Belgian Nash Hash 2026 Pub Crawl!" →
 *   first-4 normalized tokens → "bmph3 belgian nash hash"
 *
 * Returns `null` when fewer than 2 tokens (too generic to safely cluster).
 */
export function clusterGroupKey(normalizedTitle: string): string | null {
  const tokens = normalizedTitle.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  const key = tokens.slice(0, 4).join(" ");
  // Below this length the key is too generic — single short word + filler.
  // Same threshold the audit uses (PR G).
  if (key.length < 8) return null;
  return key;
}

interface ClusterEvent {
  id: string;
  date: Date;
  title: string;
  isSeriesParent: boolean;
  parentEventId: string | null;
}

const DAY_MS = 1000 * 60 * 60 * 24;
const MAX_CLUSTER_SPAN_DAYS = 7; // longest reasonable hashing weekend
const MAX_CONSECUTIVE_GAP_DAYS = 2; // allow Fri + Sat + recovery Mon

/**
 * Split a date-sorted group of events into "runs" where each run is a
 * maximal contiguous slice whose internal gaps are all in
 * `[1, MAX_CONSECUTIVE_GAP_DAYS]`. Codex P2 review on PR #1743 caught
 * that evaluating the whole bucket as one cluster causes false negatives
 * when a recurring annual event sits in the same 365-day window as the
 * current-year cluster (e.g. BMPH3 Belgian Nash Hash 2026 + 2027 share
 * the same first-4-token key but the year-apart gap makes total span
 * 365 days, which exceeds MAX_CLUSTER_SPAN_DAYS). Splitting into runs
 * lets each recurrence's weekend link independently.
 */
export function splitIntoConsecutiveRuns(sorted: ClusterEvent[]): ClusterEvent[][] {
  if (sorted.length === 0) return [];
  const runs: ClusterEvent[][] = [];
  let currentRun: ClusterEvent[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / DAY_MS;
    if (gap >= 1 && gap <= MAX_CONSECUTIVE_GAP_DAYS) {
      currentRun.push(sorted[i]);
    } else {
      runs.push(currentRun);
      currentRun = [sorted[i]];
    }
  }
  runs.push(currentRun);
  return runs;
}

/**
 * Returns true when a single run (already known to have gaps ≤
 * MAX_CONSECUTIVE_GAP_DAYS by construction) has at least 2 events AND
 * spans ≤ MAX_CLUSTER_SPAN_DAYS. The span check is the "weekend cap" —
 * a run of 10 single-day-gap events would still be rejected as too long
 * to be a single weekend.
 */
export function isConsecutiveCluster(sorted: ClusterEvent[]): boolean {
  if (sorted.length < 2) return false;
  const last = sorted.at(-1)!;
  const totalDays = (last.date.getTime() - sorted[0].date.getTime()) / DAY_MS;
  return totalDays <= MAX_CLUSTER_SPAN_DAYS;
}

interface LinkResult {
  /** Number of clusters that resulted in a new umbrella+children link. */
  clustersLinked: number;
  /** Number of canonical Events demoted to children (or promoted to parent). */
  eventsLinked: number;
}

/**
 * Scan a set of kennels' upcoming canonical events for same-title
 * consecutive-day clusters and link them. Idempotent — a cluster whose
 * members are already linked is skipped.
 */
/**
 * Build the `(kennelId, clusterGroupKey)` → events map from a flat list
 * of upcoming canonical Events. Events with missing titles or
 * non-cluster-key-eligible titles are dropped here.
 */
function bucketByClusterKey(
  events: Array<{
    id: string;
    date: Date;
    title: string | null;
    kennelId: string;
    isSeriesParent: boolean;
    parentEventId: string | null;
  }>,
): Map<string, ClusterEvent[]> {
  const buckets = new Map<string, ClusterEvent[]>();
  for (const e of events) {
    if (!e.title) continue;
    const key = clusterGroupKey(normalizeTitleForCluster(e.title));
    if (!key) continue;
    const bucketKey = `${e.kennelId}::${key}`;
    const arr = buckets.get(bucketKey) ?? [];
    arr.push({
      id: e.id,
      date: e.date,
      title: e.title,
      isSeriesParent: e.isSeriesParent,
      parentEventId: e.parentEventId,
    });
    buckets.set(bucketKey, arr);
  }
  return buckets;
}

/**
 * Run the link-or-skip decision for a single consecutive-day run, returning
 * `true` when the link was written. Extracted from the linker's main loop
 * (Sonar S3776 — keeps `linkSameTitleConsecutiveClusters` under the
 * cognitive-complexity threshold).
 */
async function linkOneRun(prisma: PrismaClient, run: ClusterEvent[]): Promise<boolean> {
  if (!isConsecutiveCluster(run)) return false;
  // Skip if ANY member of THIS run is already part of a series. Run-local;
  // another year's run can be already-linked or not without affecting this.
  if (run.some((e) => e.isSeriesParent || e.parentEventId != null)) return false;

  const parent = run[0];
  const children = run.slice(1);
  const lastDate = run.at(-1)!.date;

  // Atomic via `$transaction` — partial-link state would permanently skip
  // the cluster on subsequent runs (Codex P1 on PR #1742).
  await prisma.$transaction([
    prisma.event.update({
      where: { id: parent.id },
      data: { isSeriesParent: true, parentEventId: null, endDate: lastDate },
    }),
    prisma.event.updateMany({
      where: { id: { in: children.map((c) => c.id) } },
      data: { parentEventId: parent.id, isSeriesParent: false },
    }),
  ]);
  return true;
}

export async function linkSameTitleConsecutiveClusters(
  prisma: PrismaClient,
  kennelIds: ReadonlySet<string>,
): Promise<LinkResult> {
  const result: LinkResult = { clustersLinked: 0, eventsLinked: 0 };
  if (kennelIds.size === 0) return result;

  // Look only at upcoming, non-cancelled, non-manual canonical events.
  // Anchor to start-of-today-UTC, not `Date.now()`, so the same set of
  // events surfaces regardless of when the scrape fires (Gemini high
  // review on PR #1743). Canonical events store `date` at UTC-noon, so a
  // `Date.now() - DAY_MS` lookback fired at 18:00 UTC would land at
  // 18:00 UTC of yesterday — past yesterday's noon-anchored events, so
  // they'd be excluded from any cluster started yesterday. Floor to
  // start-of-day UTC, then offset by ±1 day.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const lookback = new Date(todayStart.getTime() - DAY_MS);
  const horizon = new Date(todayStart.getTime() + 365 * DAY_MS);
  const events = await prisma.event.findMany({
    where: {
      kennelId: { in: [...kennelIds] },
      date: { gte: lookback, lte: horizon },
      status: { not: "CANCELLED" },
      isCanonical: true,
      isManualEntry: { not: true },
    },
    select: {
      id: true,
      date: true,
      title: true,
      kennelId: true,
      isSeriesParent: true,
      parentEventId: true,
    },
    orderBy: { date: "asc" },
  });

  for (const bucket of bucketByClusterKey(events).values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.date.getTime() - b.date.getTime());
    // Split into per-weekend runs so an annual recurrence in the same window
    // doesn't disqualify the current weekend (Codex P2 on PR #1743).
    for (const run of splitIntoConsecutiveRuns(sorted)) {
      if (await linkOneRun(prisma, run)) {
        result.clustersLinked++;
        result.eventsLinked += run.length;
      }
    }
  }

  return result;
}

