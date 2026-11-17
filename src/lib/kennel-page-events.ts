import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { HIDE_STOPPED_SCHEDULE_RUNS } from "@/lib/event-filters";

/**
 * The events a kennel's public page shows, and how it counts them. Shared by
 * the page and by the onboarding backfill's verification (design 9.3, V1/V2/V5),
 * so the two can't drift.
 */

/**
 * The page's filter: every canonical, non-cancelled, non-manual event the kennel
 * hosts or co-hosts (#1023 step 5), series children included (#1560 PR F).
 * `ignoreStop` drops the stopped-kennel clause, for verification of rows that a
 * stop hides on purpose (design 9.3 V1).
 */
export function kennelPageEventWhere(
  kennelId: string,
  options?: { ignoreStop?: boolean },
): Prisma.EventWhereInput {
  const { NOT: _stopClause, ...withoutStop } = VISIBLE_EVENT;
  return { eventKennels: { some: { kennelId } }, ...(options?.ignoreStop ? withoutStop : VISIBLE_EVENT) };
}

/** What the page shows of any event, top-level or a series child. */
const VISIBLE_EVENT = {
  status: { not: "CANCELLED" },
  isManualEntry: { not: true },
  isCanonical: true,
  ...HIDE_STOPPED_SCHEDULE_RUNS,
} as const satisfies Prisma.EventWhereInput;

export async function getKennelPageEvents(kennelId: string) {
  return prisma.event.findMany({
    // #1023 step 5: filter via EventKennel join so co-host events
    // (where this kennel is a secondary, not the primary) appear here too.
    // #1560 PR F: NO `parentEventId: null` filter — series children whose
    // primary kennel is this kennel (e.g. GGFM Friday Strawberry Moon as
    // a child of NYCH3's 5-Boro umbrella) must appear on this kennel's
    // page. The `eventKennels.some` join correctly fans out to children
    // because each child gets its own primary `EventKennel` row per
    // #1023 step 2. The umbrella itself only appears on its host kennel's
    // page (its `kennelId` is the host's), so dropping the filter doesn't
    // pollute other kennel pages with parents they don't host.
    where: kennelPageEventWhere(kennelId),
    include: {
      kennel: {
        select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
      },
      // Populate co-host kennels (#1023 step 5) — surfaces the
      // "Cherry City × OH3" conjunction in EventCard for multi-kennel
      // events. Empty array for the common single-kennel case.
      eventKennels: {
        where: { isPrimary: false },
        select: {
          kennel: { select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true } },
        },
        orderBy: { kennel: { shortName: "asc" } },
      },
      // #1560 — per-trail children for series parents. Slim select to
      // match the HarelineSeriesChild shape consumed by EventCard.
      childEvents: {
        where: { ...VISIBLE_EVENT, kennel: { isHidden: false } },
        orderBy: { date: "asc" },
        select: {
          id: true,
          date: true,
          dateUtc: true,
          timezone: true,
          title: true,
          haresText: true,
          startTime: true,
          status: true,
          locationName: true,
          runNumber: true,
        },
      },
    },
    orderBy: { date: "asc" },
  });
}

export type KennelPageEvent = Awaited<ReturnType<typeof getKennelPageEvents>>[number];

/**
 * The page's "total events": unique dates, not rows, for resilience against
 * duplicate canonical events. Two runs on one date count once (the Zagreb
 * 716-vs-715 case, design 9.4).
 */
export function countKennelPageEvents(events: ReadonlyArray<{ date: Date }>): number {
  return new Set(events.map((e) => e.date.toISOString().split("T")[0])).size;
}
