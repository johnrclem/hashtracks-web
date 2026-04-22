import { prisma } from "@/lib/db";
import { TravelSearchStatus } from "@/generated/prisma/client";

/**
 * Drafts older than this are swept. Mid-flow abandonment (user adds a
 * leg 2 in the search form, then navigates away without saving) creates
 * a DRAFT TravelSearch row that is invisible from /travel/saved but
 * still counts against the partial-unique dedup index and accumulates
 * forever without GC.
 *
 * A week is chosen to leave plenty of headroom for the "I'll finish
 * this tomorrow" flow while still keeping the backlog bounded. Delete,
 * not archive — DRAFT rows have no user-facing history value and
 * ARCHIVED semantics is reserved for trips the user explicitly saved
 * then removed.
 *
 * The GC is read-path-aware: SavedTripPage in src/app/travel/page.tsx
 * bumps `updatedAt` whenever a DRAFT is reopened. That heartbeat means
 * the predicate below only catches drafts that are genuinely
 * abandoned — a bookmarked or revisited draft resets its 7-day clock
 * on each page load. If that heartbeat is ever removed, this GC
 * becomes a data-loss path for bookmarked drafts; keep them in sync.
 */
export const DRAFT_GC_AGE_DAYS = 7;

export interface TravelDraftGcResult {
  deleted: number;
  olderThan: Date;
}

/**
 * Delete DRAFT TravelSearch rows whose `updatedAt` is older than
 * `DRAFT_GC_AGE_DAYS`. TravelDestination rows cascade via the
 * compound FK (prisma/schema.prisma: TravelDestination.travelSearch
 * onDelete: Cascade).
 *
 * Returns the count of deleted parents. Safe to run concurrently
 * with save/update flows — the WHERE clause scopes strictly to
 * status='DRAFT', so an ACTIVE or ARCHIVED trip can never be caught
 * mid-transition.
 */
export async function runTravelDraftGc(
  now: Date = new Date(),
): Promise<TravelDraftGcResult> {
  const olderThan = new Date(now.getTime() - DRAFT_GC_AGE_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.travelSearch.deleteMany({
    where: {
      status: TravelSearchStatus.DRAFT,
      updatedAt: { lt: olderThan },
    },
  });
  return { deleted: count, olderThan };
}
