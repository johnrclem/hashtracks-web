import { prisma } from "@/lib/db";
import { toIsoDateString } from "@/lib/date";
import type { RawEventData } from "@/adapters/types";
import { resolveKennelTag } from "./kennel-resolver";

/** Result of stale-event reconciliation after a successful scrape. */
export interface ReconcileResult {
  /** Number of sole-source events marked CANCELLED. */
  cancelled: number;
  /** IDs of the cancelled Event records. */
  cancelledEventIds: string[];
  /** Number of CONFIRMED events examined as reconciliation candidates. */
  candidatesExamined: number;
  /** Number of orphaned events preserved because they have other sources. */
  multiSourcePreserved: number;
  /**
   * Number of past-dated orphaned events preserved because this scrape did not
   * reach back to their date for their kennel (see {@link isPastOutsideCoverage}).
   * Persistently high values on a source mean its fetch drops past runs.
   */
  pastOutsideCoverage: number;
  /** Number of kennels actually in reconciliation scope. */
  kennelsInScope: number;
  /** Total number of kennels linked to this source (for partial-scrape detection). */
  totalLinkedKennels: number;
  /**
   * Kennel IDs excluded from cancellation decisions because at least one
   * scraped row for that kennel had an unparseable date. Non-empty values are
   * a degraded-state signal — operators should investigate persistent entries
   * since stale CONFIRMED events in these kennels will not be cancelled until
   * the upstream adapter emits valid dates again.
   */
  kennelsSuppressedForBadDate: string[];
  /**
   * Set when the mass-cancel circuit breaker refused to apply this pass's
   * cancellations (see `shouldBlockMassCancel`). `cancelled` is 0 in that
   * case; `wouldCancel` is how many sole-source events the pass wanted to
   * cancel. Absent when the breaker did not trip.
   */
  massCancelBlocked?: {
    wouldCancel: number;
    /** In-window CONFIRMED candidates backed by this source (the breaker's denominator). */
    candidatesExamined: number;
  };
}

/** Options for {@link reconcileStaleEvents}. */
export interface ReconcileOptions {
  /**
   * Apply cancellations even when they trip the mass-cancel circuit breaker.
   * Operator escape hatch for a genuine mass removal (e.g. a kennel cancelled
   * its season); scheduled scrapes never set it.
   */
  allowMassCancel?: boolean;
}

/** Cancellations at or below this count never trip the breaker. */
export const MASS_CANCEL_MIN = 10;
/** Fraction of in-window CONFIRMED candidates above which a pass is blocked. */
export const MASS_CANCEL_FRACTION = 0.3;

/** One (event, source) backing row for an orphaned event. */
export interface EventBacking {
  eventId: string | null;
  sourceId: string;
  source: { enabled: boolean };
}

/**
 * Orphaned events another source shields from cancellation by `sourceId`:
 * any enabled source's row, or a disabled source's row for a run `sourceId`
 * never reported. A disabled source may be retired (its stale rows must not
 * outvote the live source that dropped the run) or paused for an outage (its
 * runs must not be cancelled by a partial secondary that never listed them).
 */
export function protectedByOtherSources(
  sourceId: string,
  rows: EventBacking[],
): Set<string> {
  const own = new Set<string>();
  const disabledOnly = new Set<string>();
  const shielded = new Set<string>();
  for (const { eventId, sourceId: rowSource, source } of rows) {
    if (!eventId) continue;
    if (rowSource === sourceId) own.add(eventId);
    else if (source.enabled) shielded.add(eventId);
    else disabledOnly.add(eventId);
  }
  for (const id of disabledOnly) if (!own.has(id)) shielded.add(id);
  return shielded;
}

/**
 * Mass-cancel circuit breaker. A single reconcile pass that would cancel more
 * than {@link MASS_CANCEL_MIN} events AND more than
 * {@link MASS_CANCEL_FRACTION} of the in-window CONFIRMED candidates this source backs
 * is far more likely to be an adapter/config regression (an unanchored
 * biweekly RRULE flipping parity, a fetch that keeps one stray old row but
 * drops the runs after it, a half-rendered page) than a real mass removal — and a false cancellation is
 * user-visible damage. Blocking is cheap: stale events stay CONFIRMED until
 * an operator confirms (`allowMassCancel`) or the source recovers.
 */
export function shouldBlockMassCancel(
  wouldCancel: number,
  candidatesExamined: number,
): boolean {
  if (wouldCancel <= MASS_CANCEL_MIN) return false;
  return wouldCancel > candidatesExamined * MASS_CANCEL_FRACTION;
}

/**
 * True when `event` is past and the scrape has no row for its kennel dated on
 * or before it: the scrape no longer reaches back that far (upcoming-runs
 * pages, rolling iCal windows, logged-out Meetup), so the miss is not a
 * removal signal. Full-history feeds still cover their past and keep
 * reconciling it. `earliestScrapedByKennel`: kennelId → earliest YYYY-MM-DD.
 */
export function isPastOutsideCoverage(
  event: { kennelId: string; date: Date },
  earliestScrapedByKennel: ReadonlyMap<string, string>,
  now: Date,
): boolean {
  if (event.date >= now) return false;
  const earliest = earliestScrapedByKennel.get(event.kennelId);
  return earliest === undefined || earliest > toIsoDateString(event.date);
}

/** Scraped rows bucketed for reconcile; see {@link bucketScrapedRows}. */
interface ScrapedBuckets {
  /** `kennelId:YYYY-MM-DD` → scraped rows for that slot. */
  scrapedBySlot: Map<string, RawEventData[]>;
  /** kennelId → earliest scraped YYYY-MM-DD (the kennel's past coverage). */
  earliestScrapedByKennel: Map<string, string>;
  /** Kennels with at least one unparseable scraped date. */
  kennelsWithUnparseableDates: Set<string>;
}

/**
 * Bucket resolved scraped rows by (kennelId, date) slot and record each
 * kennel's earliest scraped date.
 *
 * When a scraped row has an unparseable date we suppress the whole kennel, not
 * just the row: dropping the row would leave its canonical orphaned and the
 * cancellation phase would flip it to CANCELLED — strictly worse than the
 * original slot-key mismatch this hardening prevents. A later successful
 * scrape will reconcile that kennel cleanly.
 */
function bucketScrapedRows(
  scrapedEvents: RawEventData[],
  resolutions: readonly Awaited<ReturnType<typeof resolveKennelTag>>[],
  sourceId: string,
): ScrapedBuckets {
  const scrapedBySlot = new Map<string, RawEventData[]>();
  const earliestScrapedByKennel = new Map<string, string>();
  const kennelsWithUnparseableDates = new Set<string>();
  for (const [i, event] of scrapedEvents.entries()) {
    const { kennelId, matched } = resolutions[i];
    if (!matched || !kennelId) continue;
    let dateKey: string;
    try {
      dateKey = toIsoDateString(event.date);
    } catch (err) {
      // Warn once per kennel; repeat warns on every bad row would spam logs
      // when one kennel has many malformed rows.
      if (!kennelsWithUnparseableDates.has(kennelId)) {
        console.warn(
          `[reconcile] suppressing cancellations for kennel=${kennelId} on source=${sourceId} due to unparseable date: ${String(err)}`,
        );
      }
      kennelsWithUnparseableDates.add(kennelId);
      continue;
    }
    const earliest = earliestScrapedByKennel.get(kennelId);
    if (earliest === undefined || dateKey < earliest) {
      earliestScrapedByKennel.set(kennelId, dateKey);
    }
    const key = `${kennelId}:${dateKey}`;
    let list = scrapedBySlot.get(key);
    if (!list) {
      list = [];
      scrapedBySlot.set(key, list);
    }
    list.push(event);
  }
  return { scrapedBySlot, earliestScrapedByKennel, kennelsWithUnparseableDates };
}

/**
 * After a successful scrape, detect canonical Events that are no longer
 * present in the source and mark them as CANCELLED.
 *
 * Only cancels events that:
 * - Fall within the scrape time window
 * - Belong to a kennel linked to this source
 * - Are currently CONFIRMED
 * - Have NO RawEvents from another enabled source, nor from a disabled source
 *   unless this source reported the run too (`protectedByOtherSources`)
 * - Were not returned in the current scrape results
 * - If past-dated, fall within the scrape's past coverage for their kennel
 *   (`isPastOutsideCoverage`); `upcomingOnly` skips the past side entirely
 *
 * A pass that would cancel too many events at once is blocked by the
 * mass-cancel circuit breaker (`shouldBlockMassCancel`) unless
 * `options.allowMassCancel` is set.
 */
export async function reconcileStaleEvents(
  sourceId: string,
  scrapedEvents: RawEventData[],
  days: number,
  scrapedKennelIds?: string[],
  upcomingOnly?: boolean,
  options?: ReconcileOptions,
): Promise<ReconcileResult> {
  const emptyResult: ReconcileResult = {
    cancelled: 0, cancelledEventIds: [],
    candidatesExamined: 0, multiSourcePreserved: 0, pastOutsideCoverage: 0,
    kennelsInScope: 0, totalLinkedKennels: 0,
    kennelsSuppressedForBadDate: [],
  };

  // Resolve kennelId for every scraped event up front so we can bucket them by
  // (kennelId, date) slot below. Slot membership drives the orphan decision
  // after we query canonical candidates from the DB.
  const resolutions = await Promise.all(
    scrapedEvents.map((event) => resolveKennelTag(event.kennelTags[0], sourceId)),
  );
  const { scrapedBySlot, earliestScrapedByKennel, kennelsWithUnparseableDates } =
    bucketScrapedRows(scrapedEvents, resolutions, sourceId);

  // Get all kennel IDs linked to this source
  const sourceKennels = await prisma.sourceKennel.findMany({
    where: { sourceId },
    select: { kennelId: true },
  });
  const allLinkedKennelIds = sourceKennels.map((sk) => sk.kennelId);

  if (allLinkedKennelIds.length === 0) {
    return emptyResult;
  }

  // When scrapedKennelIds is provided, only reconcile events for kennels that were
  // actually in scope for the scrape. This prevents false cancellations when the
  // adapter only scrapes a subset of linked kennels (e.g., HASHREGO with partial
  // externalSlug coverage).
  let linkedKennelIds: string[];
  if (scrapedKennelIds) {
    const scrapedSet = new Set(scrapedKennelIds);
    linkedKennelIds = allLinkedKennelIds.filter((id) => scrapedSet.has(id));
  } else {
    linkedKennelIds = allLinkedKennelIds;
  }

  // Fail-safe: kennels with any unparseable scraped date are excluded from
  // cancellation decisions this run. See the scrapedBySlot loop above for rationale.
  // Intersect with linkedKennelIds (pre-mutation) so the reported set only
  // contains kennels that were actually in-scope for cancellation decisions —
  // otherwise a resolved-but-unlinked kennel would show up as "suppressed"
  // despite never being a reconcile candidate, adding noise for downstream alerts.
  const suppressedKennels = linkedKennelIds.filter((id) =>
    kennelsWithUnparseableDates.has(id),
  );
  if (suppressedKennels.length > 0) {
    linkedKennelIds = linkedKennelIds.filter(
      (id) => !kennelsWithUnparseableDates.has(id),
    );
  }

  if (linkedKennelIds.length === 0) {
    return {
      ...emptyResult,
      totalLinkedKennels: allLinkedKennelIds.length,
      kennelsSuppressedForBadDate: suppressedKennels,
    };
  }

  // `upcomingOnly` skips the past side entirely; still needed when a fetch
  // keeps one stray old row, which makes the gap after it look covered.
  const now = new Date();
  const timeMin = upcomingOnly
    ? now
    : new Date(now.getTime() - days * 86_400_000);
  const timeMax = new Date(now.getTime() + days * 86_400_000);

  // Find CONFIRMED canonical events in the window for this source's kennels.
  // Non-canonical audit rows (merge conflicts kept for fidelity — see
  // prisma/schema.prisma isCanonical docs) are never displayed and must not be
  // counted as double-header peers, or single-canonical slots with shadow rows
  // would incorrectly fall into the multi-candidate cancellation path.
  //
  // Tradeoff: if a scrape row binds (via merge semantics) to a non-canonical
  // shadow rather than the displayed canonical, reconcile here sees only the
  // canonical and preserves it on any slot hit. That can leave a truly-stale
  // canonical CONFIRMED until the next merge run re-promotes the shadow. We
  // accept this because the alternative (including shadows as peers and then
  // cancelling the canonical when a shadow matches) causes user-visible
  // disappearances of displayed events for a rare merge-conflict state.
  const candidates = await prisma.event.findMany({
    where: {
      kennelId: { in: linkedKennelIds },
      date: { gte: timeMin, lte: timeMax },
      status: "CONFIRMED",
      isCanonical: true,
    },
    select: {
      id: true,
      kennelId: true,
      date: true,
      sourceUrl: true,
      startTime: true,
      title: true,
    },
  });

  // Group candidates by (kennelId, date) slot. Single-candidate slots tolerate
  // sourceUrl drift (many adapters emit the same run with different URLs across
  // upcoming/past/detail pages — the "sourceUrl drift" false-cancellation bug).
  // Multi-candidate slots are genuine double-headers and must disambiguate
  // using the same cascade the merge pipeline uses to pick an update target
  // (sourceUrl → startTime → title — see src/pipeline/merge.ts upsertCanonicalEvent).
  const candidatesByKey = new Map<string, typeof candidates>();
  for (const event of candidates) {
    const key = `${event.kennelId}:${toIsoDateString(event.date)}`;
    let list = candidatesByKey.get(key);
    if (!list) {
      list = [];
      candidatesByKey.set(key, list);
    }
    list.push(event);
  }

  // For each scraped event, mark which canonical Event (if any) it would
  // bind to under merge semantics. Unmatched candidates are orphaned.
  const matchedCandidateIds = new Set<string>();
  for (const [key, slotCandidates] of candidatesByKey) {
    const scrapedForSlot = scrapedBySlot.get(key);
    if (!scrapedForSlot || scrapedForSlot.length === 0) continue;
    if (slotCandidates.length === 1) {
      // Single canonical in the slot — any scrape hit preserves it.
      matchedCandidateIds.add(slotCandidates[0].id);
      continue;
    }
    // Double-header: mirror merge's URL → startTime → title cascade. Each
    // scraped event binds to at most one canonical; once a candidate is
    // claimed in this slot, later scraped events fall through to the next
    // tier (so two scraped rows without distinguishing fields can't both
    // claim the same canonical and leave another one looking orphaned).
    //
    // This is intentionally stricter than merge's length>1 branch (which has
    // no claim tracking and can bind two rows to the same canonical): reconcile
    // errs toward preserving canonicals on ambiguous matches because a false
    // cancellation is user-visible damage, whereas leaving a truly-stale row
    // CONFIRMED is self-healing on the next full scrape.
    //
    // Bare-row guard: a scraped row with no sourceUrl, startTime, or title
    // cannot bind to any specific canonical in a double-header slot. Rather
    // than orphan every canonical in the slot, preserve all of them — the
    // scrape proves *some* run happened that day, we just can't tell which.
    const hasBareScrape = scrapedForSlot.some(
      (s) => !s.sourceUrl && !s.startTime && !s.title,
    );
    if (hasBareScrape) {
      for (const c of slotCandidates) matchedCandidateIds.add(c.id);
      continue;
    }
    const claimed = new Set<string>();
    for (const scraped of scrapedForSlot) {
      const pick = (predicate: (c: (typeof slotCandidates)[number]) => boolean) =>
        slotCandidates.find((c) => !claimed.has(c.id) && predicate(c));
      let match: (typeof slotCandidates)[number] | undefined;
      if (scraped.sourceUrl) {
        match = pick((c) => c.sourceUrl === scraped.sourceUrl);
      }
      if (!match && scraped.startTime) {
        match = pick((c) => c.startTime === scraped.startTime);
      }
      if (!match && scraped.title) {
        match = pick((c) => c.title === scraped.title);
      }
      if (match) {
        claimed.add(match.id);
        matchedCandidateIds.add(match.id);
      }
    }
  }

  // Candidates this pass could cancel at all: matched ones are always covered,
  // so this is every candidate minus the protected past ones.
  const cancellable = candidates.filter(
    (c) => !isPastOutsideCoverage(c, earliestScrapedByKennel, now),
  );
  const orphaned = cancellable.filter((c) => !matchedCandidateIds.has(c.id));

  const baseDiag = {
    candidatesExamined: candidates.length,
    pastOutsideCoverage: candidates.length - cancellable.length,
    kennelsInScope: linkedKennelIds.length,
    totalLinkedKennels: allLinkedKennelIds.length,
    kennelsSuppressedForBadDate: suppressedKennels,
  };

  if (orphaned.length === 0) {
    return { cancelled: 0, cancelledEventIds: [], multiSourcePreserved: 0, ...baseDiag };
  }

  // Who backs each orphaned event (single query on the RawEvent.eventId index)
  const backing = await prisma.rawEvent.findMany({
    where: { eventId: { in: orphaned.map((e) => e.id) } },
    select: { eventId: true, sourceId: true, source: { select: { enabled: true } } },
    distinct: ["eventId", "sourceId"],
  });
  const eventsWithOtherSources = protectedByOtherSources(sourceId, backing);
  const cancelledEventIds = orphaned
    .filter((event) => !eventsWithOtherSources.has(event.id))
    .map((event) => event.id);

  // Mass-cancel circuit breaker. The denominator is the candidates THIS source
  // backs (has RawEvents for), not every CONFIRMED event in the linked kennels:
  // events only another source supplies would otherwise dilute the fraction and
  // let a broken secondary source wipe out most of its own rows. Past runs the
  // coverage guard protects are left out too, for the same reason. Only queried
  // when the floor is exceeded, so ordinary passes pay nothing extra.
  if (!options?.allowMassCancel && cancelledEventIds.length > MASS_CANCEL_MIN) {
    const ownBacked = await prisma.rawEvent.groupBy({
      by: ["eventId"],
      where: { eventId: { in: cancellable.map((c) => c.id) }, sourceId },
    });
    const sourceCandidates = ownBacked.length;
    if (shouldBlockMassCancel(cancelledEventIds.length, sourceCandidates)) {
      return {
        cancelled: 0,
        cancelledEventIds: [],
        multiSourcePreserved: eventsWithOtherSources.size,
        ...baseDiag,
        massCancelBlocked: {
          wouldCancel: cancelledEventIds.length,
          candidatesExamined: sourceCandidates,
        },
      };
    }
  }

  // Batch update all sole-source orphaned events to CANCELLED
  if (cancelledEventIds.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: cancelledEventIds } },
      data: { status: "CANCELLED" },
    });
  }

  return {
    cancelled: cancelledEventIds.length,
    cancelledEventIds,
    multiSourcePreserved: eventsWithOtherSources.size,
    ...baseDiag,
  };
}
