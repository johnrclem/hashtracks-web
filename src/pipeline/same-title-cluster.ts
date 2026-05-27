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
 * Returns true when the sorted-by-date events form at least one
 * consecutive-pair (gap ∈ [1, MAX_CONSECUTIVE_GAP_DAYS]) AND the total
 * span across the cluster is ≤ MAX_CLUSTER_SPAN_DAYS. Mirrors the audit's
 * A.5 check.
 */
export function isConsecutiveCluster(sorted: ClusterEvent[]): boolean {
  if (sorted.length < 2) return false;
  let hasConsecutivePair = false;
  for (let i = 1; i < sorted.length; i++) {
    const gap = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / DAY_MS;
    if (gap >= 1 && gap <= MAX_CONSECUTIVE_GAP_DAYS) {
      hasConsecutivePair = true;
      break;
    }
  }
  if (!hasConsecutivePair) return false;
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

  // Bucket by (kennelId, clusterGroupKey).
  const buckets = new Map<string, ClusterEvent[]>();
  for (const e of events) {
    if (!e.title) continue;
    const norm = normalizeTitleForCluster(e.title);
    const key = clusterGroupKey(norm);
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

  for (const cluster of buckets.values()) {
    if (cluster.length < 2) continue;
    const sorted = [...cluster].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (!isConsecutiveCluster(sorted)) continue;

    // Skip if ANY member is already part of a series — adapter-emitted
    // seriesId or a prior linker run owns this group.
    if (sorted.some((e) => e.isSeriesParent || e.parentEventId != null)) continue;

    const parent = sorted[0];
    const children = sorted.slice(1);
    const lastDate = sorted.at(-1)!.date;

    // Two writes wrapped in `$transaction` so a write failure can't leave
    // a half-linked cluster (Codex P1 review on PR #1742). If the parent
    // promotion succeeded but the children update failed, future runs
    // would PERMANENTLY skip this cluster because the parent now satisfies
    // the "any member already linked" gate. Atomic commit prevents that.
    //
    // Mirrors `writeSeriesLinks` but also writes endDate — this linker
    // can't rely on an adapter-emitted endDate because there's no
    // umbrella raw.
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
    result.clustersLinked++;
    result.eventsLinked += sorted.length;
  }

  return result;
}

