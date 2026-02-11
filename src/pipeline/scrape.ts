import { prisma } from "@/lib/db";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents, updateSourceHealth } from "./merge";

export interface ScrapeSourceResult {
  success: boolean;
  scrapeLogId: string;
  forced: boolean;
  eventsFound: number;
  created: number;
  updated: number;
  skipped: number;
  unmatched: string[];
  errors: string[];
}

/**
 * Scrape a single source: fetch → merge → update health → log.
 * Used by both the admin scrape API and the cron endpoint.
 */
export async function scrapeSource(
  sourceId: string,
  options?: { days?: number; force?: boolean },
): Promise<ScrapeSourceResult> {
  const days = options?.days ?? 90;
  const force = options?.force ?? false;

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  // Create ScrapeLog record
  const startedAt = new Date();
  const scrapeLog = await prisma.scrapeLog.create({
    data: {
      sourceId,
      forced: force,
    },
  });

  try {
    // If force mode, delete old RawEvents to allow full re-processing
    if (force) {
      await prisma.rawEvent.deleteMany({
        where: { sourceId },
      });
    }

    // Get the adapter for this source type
    const adapter = getAdapter(source.type);

    // Run the scrape
    const scrapeResult = await adapter.fetch(source, { days });

    // Process raw events through the merge pipeline
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);

    // Update source health
    await updateSourceHealth(sourceId, mergeResult, scrapeResult.errors);

    // Update ScrapeLog with results
    const completedAt = new Date();
    const hasErrors = scrapeResult.errors.length > 0;
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: hasErrors ? "FAILED" : "SUCCESS",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        eventsFound: scrapeResult.events.length,
        eventsCreated: mergeResult.created,
        eventsUpdated: mergeResult.updated,
        eventsSkipped: mergeResult.skipped,
        unmatchedTags: mergeResult.unmatched,
        errors: scrapeResult.errors,
      },
    });

    return {
      success: true,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: scrapeResult.events.length,
      created: mergeResult.created,
      updated: mergeResult.updated,
      skipped: mergeResult.skipped,
      unmatched: mergeResult.unmatched,
      errors: scrapeResult.errors,
    };
  } catch (err) {
    // Update ScrapeLog as failed
    const completedAt = new Date();
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errors: [err instanceof Error ? err.message : String(err)],
      },
    });

    // Update source as failing
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        lastScrapeAt: new Date(),
        healthStatus: "FAILING",
      },
    });

    return {
      success: false,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      unmatched: [],
      errors: [err instanceof Error ? err.message : String(err)],
    };
  }
}
