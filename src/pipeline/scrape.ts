import { prisma } from "@/lib/db";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "./merge";
import { computeFillRates } from "./fill-rates";
import { analyzeHealth, persistAlerts } from "./health";

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
 * Scrape a single source: fetch → fill rates → merge → health analysis → alerts → log.
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

    // Compute field fill rates
    const fillRates = computeFillRates(scrapeResult.events);

    // Process raw events through the merge pipeline
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);

    // Combine scrape errors with merge event errors
    const allErrors = [
      ...scrapeResult.errors,
      ...mergeResult.eventErrorMessages,
    ];

    // Update ScrapeLog with results + quality metrics
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
        errors: allErrors,
        fillRateTitle: fillRates.title,
        fillRateLocation: fillRates.location,
        fillRateHares: fillRates.hares,
        fillRateStartTime: fillRates.startTime,
        fillRateRunNumber: fillRates.runNumber,
        structureHash: scrapeResult.structureHash,
      },
    });

    // Analyze health and create/update alerts
    const health = await analyzeHealth(sourceId, scrapeLog.id, {
      eventsFound: scrapeResult.events.length,
      scrapeFailed: hasErrors,
      errors: allErrors,
      unmatchedTags: mergeResult.unmatched,
      fillRates,
      structureHash: scrapeResult.structureHash,
    });

    // Update source health status
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        lastScrapeAt: completedAt,
        lastSuccessAt: health.healthStatus !== "FAILING" ? completedAt : undefined,
        healthStatus: health.healthStatus,
      },
    });

    // Persist alerts
    if (health.alerts.length > 0) {
      await persistAlerts(sourceId, scrapeLog.id, health.alerts);
    }

    return {
      success: true,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: scrapeResult.events.length,
      created: mergeResult.created,
      updated: mergeResult.updated,
      skipped: mergeResult.skipped,
      unmatched: mergeResult.unmatched,
      errors: allErrors,
    };
  } catch (err) {
    // Update ScrapeLog as failed
    const completedAt = new Date();
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errors: [errorMsg],
      },
    });

    // Run health analysis for the failure case
    const health = await analyzeHealth(sourceId, scrapeLog.id, {
      eventsFound: 0,
      scrapeFailed: true,
      errors: [errorMsg],
      unmatchedTags: [],
      fillRates: { title: 0, location: 0, hares: 0, startTime: 0, runNumber: 0 },
    });

    // Update source health
    await prisma.source.update({
      where: { id: sourceId },
      data: {
        lastScrapeAt: completedAt,
        healthStatus: health.healthStatus,
      },
    });

    // Persist alerts
    if (health.alerts.length > 0) {
      await persistAlerts(sourceId, scrapeLog.id, health.alerts);
    }

    return {
      success: false,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      unmatched: [],
      errors: [errorMsg],
    };
  }
}
