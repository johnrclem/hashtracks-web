import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ErrorDetails } from "@/adapters/types";
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
  blocked: number;
  unmatched: string[];
  blockedTags: string[];
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

    // Get the adapter for this source type (URL used for HTML scraper routing)
    const adapter = getAdapter(source.type, source.url);

    // Run the scrape (Phase 3A: capture fetch timing)
    const fetchStart = Date.now();
    const scrapeResult = await adapter.fetch(source, { days });
    const fetchDurationMs = Date.now() - fetchStart;

    // Compute field fill rates
    const fillRates = computeFillRates(scrapeResult.events);

    // Process raw events through the merge pipeline (Phase 3A: capture merge timing)
    const mergeStart = Date.now();
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);
    const mergeDurationMs = Date.now() - mergeStart;

    // Combine scrape errors with merge event errors
    const allErrors = [
      ...scrapeResult.errors,
      ...mergeResult.eventErrorMessages,
    ];

    // Phase 2A: Combine errorDetails from adapter + merge pipeline
    const combinedErrorDetails: ErrorDetails = {
      ...(scrapeResult.errorDetails ?? {}),
    };
    if (mergeResult.mergeErrorDetails && mergeResult.mergeErrorDetails.length > 0) {
      combinedErrorDetails.merge = mergeResult.mergeErrorDetails;
    }
    const hasErrorDetails =
      (combinedErrorDetails.fetch?.length ?? 0) > 0 ||
      (combinedErrorDetails.parse?.length ?? 0) > 0 ||
      (combinedErrorDetails.merge?.length ?? 0) > 0;

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
        // Phase 2A: Structured error details
        errorDetails: hasErrorDetails
          ? (combinedErrorDetails as unknown as Prisma.InputJsonValue)
          : undefined,
        // Phase 2B: Store sample blocked/skipped events
        sampleBlocked: mergeResult.sampleBlocked as unknown as Prisma.InputJsonValue | undefined,
        sampleSkipped: mergeResult.sampleSkipped as unknown as Prisma.InputJsonValue | undefined,
        // Phase 3A: Performance timing
        fetchDurationMs,
        mergeDurationMs,
        // Phase 3B: Per-adapter diagnostic context
        diagnosticContext: scrapeResult.diagnosticContext
          ? (scrapeResult.diagnosticContext as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // Analyze health and create/update alerts
    const health = await analyzeHealth(sourceId, scrapeLog.id, {
      eventsFound: scrapeResult.events.length,
      scrapeFailed: hasErrors,
      errors: allErrors,
      unmatchedTags: mergeResult.unmatched,
      blockedTags: mergeResult.blockedTags,
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
      blocked: mergeResult.blocked,
      unmatched: mergeResult.unmatched,
      blockedTags: mergeResult.blockedTags,
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
        // Phase 2A: Structured error for total failure
        errorDetails: {
          fetch: [{ message: errorMsg }],
        } as unknown as Prisma.InputJsonValue,
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
      blocked: 0,
      unmatched: [],
      blockedTags: [],
      errors: [errorMsg],
    };
  }
}
