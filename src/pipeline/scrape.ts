import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ErrorDetails, AiRecoverySummary } from "@/adapters/types";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "./merge";
import { computeFillRates } from "./fill-rates";
import { analyzeHealth, persistAlerts } from "./health";
import { attemptAiRecovery, isAiRecoveryAvailable } from "@/lib/ai/parse-recovery";

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
  aiRecovery?: AiRecoverySummary;
}

/**
 * Scrape a single source: fetch → AI recovery → fill rates → merge → health analysis → alerts → log.
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

    // ── AI Recovery: attempt to recover events from parse errors ──
    // If the adapter reported parse errors with rawText and Gemini is available,
    // try to extract structured data that the deterministic parser missed.
    let aiRecovery: AiRecoverySummary | undefined;
    const parseErrors = scrapeResult.errorDetails?.parse ?? [];
    const recoverableErrors = parseErrors.filter((e) => e.rawText);

    if (recoverableErrors.length > 0 && isAiRecoveryAvailable()) {
      // Use first event's kennelTag as default, or source name as fallback
      const defaultKennelTag = scrapeResult.events[0]?.kennelTag
        ?? parseErrors[0]?.partialData?.kennelTag
        ?? source.name;

      aiRecovery = await attemptAiRecovery(recoverableErrors, defaultKennelTag);

      // Add recovered events to the scrape result
      if (aiRecovery.succeeded > 0) {
        for (const result of aiRecovery.results) {
          scrapeResult.events.push(result.recovered);
        }

        // Remove parse errors that were successfully recovered
        const recoveredRows = new Set(aiRecovery.results.map((r) => r.parseError.row));
        if (scrapeResult.errorDetails?.parse) {
          scrapeResult.errorDetails.parse = scrapeResult.errorDetails.parse.filter(
            (e) => !recoveredRows.has(e.row),
          );
        }
        // Also remove corresponding flat errors
        const recoveredErrorPrefixes = aiRecovery.results.map(
          (r) => r.parseError.error,
        );
        const originalErrors = [...scrapeResult.errors];
        scrapeResult.errors = originalErrors.filter(
          (e) => !recoveredErrorPrefixes.some((prefix) => e.includes(prefix)),
        );
      }

      scrapeResult.aiRecovery = aiRecovery;
    }

    // Compute field fill rates (now includes AI-recovered events)
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

    // Build diagnostic context (includes AI recovery metrics)
    const diagnosticContext: Record<string, unknown> = {
      ...(scrapeResult.diagnosticContext ?? {}),
    };
    if (aiRecovery && aiRecovery.attempted > 0) {
      diagnosticContext.aiRecovery = {
        attempted: aiRecovery.attempted,
        succeeded: aiRecovery.succeeded,
        failed: aiRecovery.failed,
        durationMs: aiRecovery.durationMs,
        recoveredFields: aiRecovery.results.map((r) => ({
          fields: r.fieldsRecovered,
          confidence: r.confidence,
        })),
      };
    }

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
        // Phase 2B: Store sample blocked/skipped events (only if non-empty;
        // storing empty arrays would cause the page query to match scrape logs
        // with no actual samples, masking older logs that had real samples)
        sampleBlocked: mergeResult.sampleBlocked?.length
          ? (mergeResult.sampleBlocked as unknown as Prisma.InputJsonValue)
          : undefined,
        sampleSkipped: mergeResult.sampleSkipped?.length
          ? (mergeResult.sampleSkipped as unknown as Prisma.InputJsonValue)
          : undefined,
        // Phase 3A: Performance timing
        fetchDurationMs,
        mergeDurationMs,
        // Phase 3B: Per-adapter diagnostic context (now includes AI recovery)
        diagnosticContext: Object.keys(diagnosticContext).length > 0
          ? (diagnosticContext as unknown as Prisma.InputJsonValue)
          : undefined,
      },
    });

    // Analyze health and create/update alerts (include AI recovery context)
    const health = await analyzeHealth(sourceId, scrapeLog.id, {
      eventsFound: scrapeResult.events.length,
      scrapeFailed: hasErrors,
      errors: allErrors,
      unmatchedTags: mergeResult.unmatched,
      blockedTags: mergeResult.blockedTags,
      fillRates,
      structureHash: scrapeResult.structureHash,
      aiRecovery: aiRecovery && aiRecovery.attempted > 0
        ? { attempted: aiRecovery.attempted, succeeded: aiRecovery.succeeded, failed: aiRecovery.failed }
        : undefined,
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
      aiRecovery,
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
