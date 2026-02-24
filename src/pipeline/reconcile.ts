import { prisma } from "@/lib/db";
import type { RawEventData } from "@/adapters/types";
import { resolveKennelTag } from "./kennel-resolver";

/** Result of stale-event reconciliation after a successful scrape. */
export interface ReconcileResult {
  /** Number of sole-source events marked CANCELLED. */
  cancelled: number;
  /** IDs of the cancelled Event records. */
  cancelledEventIds: string[];
}

/**
 * After a successful scrape, detect canonical Events that are no longer
 * present in the source and mark them as CANCELLED.
 *
 * Only cancels events that:
 * - Fall within the scrape time window
 * - Belong to a kennel linked to this source
 * - Are currently CONFIRMED
 * - Have NO RawEvents from any other source (sole-source events)
 * - Were not returned in the current scrape results
 */
export async function reconcileStaleEvents(
  sourceId: string,
  scrapedEvents: RawEventData[],
  days: number,
): Promise<ReconcileResult> {
  // Build set of (kennelId, date) keys from the scrape results
  const scrapedKeys = new Set<string>();
  const resolutions = await Promise.all(
    scrapedEvents.map((event) => resolveKennelTag(event.kennelTag, sourceId)),
  );
  for (const [i, event] of scrapedEvents.entries()) {
    const { kennelId, matched } = resolutions[i];
    if (matched && kennelId) {
      scrapedKeys.add(`${kennelId}:${event.date}`);
    }
  }

  // Get all kennel IDs linked to this source
  const sourceKennels = await prisma.sourceKennel.findMany({
    where: { sourceId },
    select: { kennelId: true },
  });
  const linkedKennelIds = sourceKennels.map((sk) => sk.kennelId);

  if (linkedKennelIds.length === 0) {
    return { cancelled: 0, cancelledEventIds: [] };
  }

  // Compute the scrape time window (same as adapter)
  const now = new Date();
  const timeMin = new Date(now.getTime() - days * 86_400_000);
  const timeMax = new Date(now.getTime() + days * 86_400_000);

  // Find CONFIRMED events in the window for this source's kennels
  const candidates = await prisma.event.findMany({
    where: {
      kennelId: { in: linkedKennelIds },
      date: { gte: timeMin, lte: timeMax },
      status: "CONFIRMED",
    },
    select: {
      id: true,
      kennelId: true,
      date: true,
    },
  });

  // Filter to events NOT in the scraped set
  const orphaned = candidates.filter((event) => {
    const dateStr = event.date.toISOString().split("T")[0];
    const key = `${event.kennelId}:${dateStr}`;
    return !scrapedKeys.has(key);
  });

  if (orphaned.length === 0) {
    return { cancelled: 0, cancelledEventIds: [] };
  }

  // Check which orphaned events have RawEvents from other sources (single query)
  const orphanedEventIds = orphaned.map((e) => e.id);
  const rawEventsFromOtherSources = await prisma.rawEvent.groupBy({
    by: ["eventId"],
    where: {
      eventId: { in: orphanedEventIds },
      sourceId: { not: sourceId },
    },
  });
  const eventsWithOtherSources = new Set(
    rawEventsFromOtherSources.map((g) => g.eventId),
  );
  const cancelledEventIds = orphaned
    .filter((event) => !eventsWithOtherSources.has(event.id))
    .map((event) => event.id);

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
  };
}
