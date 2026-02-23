import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ErrorDetails, AiRecoverySummary, ScrapeResult, MergeResult } from "@/adapters/types";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "./merge";
import { reconcileStaleEvents } from "./reconcile";
import { computeFillRates } from "./fill-rates";
import type { FieldFillRates } from "./fill-rates";
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
  cancelled: number;
  unmatched: string[];
  blockedTags: string[];
  errors: string[];
  aiRecovery?: AiRecoverySummary;
}

/**
 * Run AI recovery on parse errors that have rawText.
 * Modifies scrapeResult in place: adds recovered events, removes recovered errors.
 */
async function runAiRecovery(
  scrapeResult: ScrapeResult,
  sourceName: string,
): Promise<AiRecoverySummary | undefined> {
  const parseErrors = scrapeResult.errorDetails?.parse ?? [];
  const recoverableErrors = parseErrors.filter((e) => e.rawText);

  if (recoverableErrors.length === 0 || !isAiRecoveryAvailable()) {
    return undefined;
  }

  const defaultKennelTag = scrapeResult.events[0]?.kennelTag
    ?? parseErrors[0]?.partialData?.kennelTag
    ?? sourceName;

  const aiRecovery = await attemptAiRecovery(recoverableErrors, defaultKennelTag);

  if (aiRecovery.succeeded > 0) {
    for (const result of aiRecovery.results) {
      scrapeResult.events.push(result.recovered);
    }

    const recoveredRows = new Set(aiRecovery.results.map((r) => r.parseError.row));
    if (scrapeResult.errorDetails?.parse) {
      scrapeResult.errorDetails.parse = scrapeResult.errorDetails.parse.filter(
        (e) => !recoveredRows.has(e.row),
      );
    }
    const recoveredErrorPrefixes = aiRecovery.results.map(
      (r) => r.parseError.error,
    );
    const originalErrors = [...scrapeResult.errors];
    scrapeResult.errors = originalErrors.filter(
      (e) => !recoveredErrorPrefixes.some((prefix) => e.includes(prefix)),
    );
  }

  scrapeResult.aiRecovery = aiRecovery;
  return aiRecovery;
}

/** Combine scrape + merge errors into a unified ErrorDetails object. */
function buildCombinedErrorDetails(
  scrapeErrorDetails: ErrorDetails | undefined,
  mergeErrorDetails: MergeResult["mergeErrorDetails"],
): { combined: ErrorDetails; hasErrors: boolean } {
  const combined: ErrorDetails = { ...(scrapeErrorDetails ?? {}) };
  if (mergeErrorDetails && mergeErrorDetails.length > 0) {
    combined.merge = mergeErrorDetails;
  }
  const hasErrors =
    (combined.fetch?.length ?? 0) > 0 ||
    (combined.parse?.length ?? 0) > 0 ||
    (combined.merge?.length ?? 0) > 0;
  return { combined, hasErrors };
}

/** Build the diagnostic context record, including AI recovery metrics. */
function buildDiagnosticContext(
  baseDiagnostics: Record<string, unknown> | undefined,
  aiRecovery: AiRecoverySummary | undefined,
): Record<string, unknown> {
  const diagnosticContext: Record<string, unknown> = { ...(baseDiagnostics ?? {}) };
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
  return diagnosticContext;
}

/** Update the ScrapeLog record with full results and quality metrics. */
async function updateScrapeLogWithResults(
  scrapeLogId: string,
  startedAt: Date,
  scrapeResult: ScrapeResult,
  mergeResult: MergeResult,
  cancelledCount: number,
  fillRates: FieldFillRates,
  combinedErrorDetails: ErrorDetails,
  hasErrorDetails: boolean,
  diagnosticContext: Record<string, unknown>,
  fetchDurationMs: number,
  mergeDurationMs: number,
): Promise<void> {
  const completedAt = new Date();
  const hasErrors = scrapeResult.errors.length > 0;
  await prisma.scrapeLog.update({
    where: { id: scrapeLogId },
    data: {
      status: hasErrors ? "FAILED" : "SUCCESS",
      completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      eventsFound: scrapeResult.events.length,
      eventsCreated: mergeResult.created,
      eventsUpdated: mergeResult.updated,
      eventsSkipped: mergeResult.skipped,
      eventsCancelled: cancelledCount,
      unmatchedTags: mergeResult.unmatched,
      errors: [...scrapeResult.errors, ...mergeResult.eventErrorMessages],
      fillRateTitle: fillRates.title,
      fillRateLocation: fillRates.location,
      fillRateHares: fillRates.hares,
      fillRateStartTime: fillRates.startTime,
      fillRateRunNumber: fillRates.runNumber,
      structureHash: scrapeResult.structureHash,
      errorDetails: hasErrorDetails
        ? (combinedErrorDetails as unknown as Prisma.InputJsonValue)
        : undefined,
      sampleBlocked: mergeResult.sampleBlocked?.length
        ? (mergeResult.sampleBlocked as unknown as Prisma.InputJsonValue)
        : undefined,
      sampleSkipped: mergeResult.sampleSkipped?.length
        ? (mergeResult.sampleSkipped as unknown as Prisma.InputJsonValue)
        : undefined,
      fetchDurationMs,
      mergeDurationMs,
      diagnosticContext: Object.keys(diagnosticContext).length > 0
        ? (diagnosticContext as unknown as Prisma.InputJsonValue)
        : undefined,
    },
  });
}

/** Run health analysis, update source health, and persist any alerts. */
async function runHealthAndAlerts(
  sourceId: string,
  scrapeLogId: string,
  completedAt: Date,
  healthInput: Parameters<typeof analyzeHealth>[2],
): Promise<void> {
  const health = await analyzeHealth(sourceId, scrapeLogId, healthInput);

  await prisma.source.update({
    where: { id: sourceId },
    data: {
      lastScrapeAt: completedAt,
      lastSuccessAt: health.healthStatus !== "FAILING" ? completedAt : undefined,
      healthStatus: health.healthStatus,
    },
  });

  if (health.alerts.length > 0) {
    await persistAlerts(sourceId, scrapeLogId, health.alerts);
  }
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
    if (force) {
      await prisma.rawEvent.deleteMany({ where: { sourceId } });
    }

    const adapter = getAdapter(source.type, source.url);

    const fetchStart = Date.now();
    const scrapeResult = await adapter.fetch(source, { days });
    const fetchDurationMs = Date.now() - fetchStart;

    // AI Recovery
    const aiRecovery = await runAiRecovery(scrapeResult, source.name);

    const fillRates = computeFillRates(scrapeResult.events);

    const mergeStart = Date.now();
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);
    const mergeDurationMs = Date.now() - mergeStart;

    // Reconcile stale events
    let cancelledCount = 0;
    if (!force && scrapeResult.events.length > 0 && scrapeResult.errors.length === 0) {
      const reconciled = await reconcileStaleEvents(sourceId, scrapeResult.events, days);
      cancelledCount = reconciled.cancelled;
    }

    const allErrors = [...scrapeResult.errors, ...mergeResult.eventErrorMessages];
    const { combined: combinedErrorDetails, hasErrors: hasErrorDetails } =
      buildCombinedErrorDetails(scrapeResult.errorDetails, mergeResult.mergeErrorDetails);
    const diagnosticContext = buildDiagnosticContext(scrapeResult.diagnosticContext, aiRecovery);

    await updateScrapeLogWithResults(
      scrapeLog.id, startedAt, scrapeResult, mergeResult,
      cancelledCount, fillRates, combinedErrorDetails, hasErrorDetails,
      diagnosticContext, fetchDurationMs, mergeDurationMs,
    );

    const completedAt = new Date();
    await runHealthAndAlerts(sourceId, scrapeLog.id, completedAt, {
      eventsFound: scrapeResult.events.length,
      scrapeFailed: scrapeResult.errors.length > 0,
      errors: allErrors,
      unmatchedTags: mergeResult.unmatched,
      blockedTags: mergeResult.blockedTags,
      fillRates,
      structureHash: scrapeResult.structureHash,
      aiRecovery: aiRecovery && aiRecovery.attempted > 0
        ? { attempted: aiRecovery.attempted, succeeded: aiRecovery.succeeded, failed: aiRecovery.failed }
        : undefined,
    });

    return {
      success: true,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: scrapeResult.events.length,
      created: mergeResult.created,
      updated: mergeResult.updated,
      skipped: mergeResult.skipped,
      blocked: mergeResult.blocked,
      cancelled: cancelledCount,
      unmatched: mergeResult.unmatched,
      blockedTags: mergeResult.blockedTags,
      errors: allErrors,
      aiRecovery,
    };
  } catch (err) {
    const completedAt = new Date();
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        status: "FAILED",
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        errors: [errorMsg],
        errorDetails: {
          fetch: [{ message: errorMsg }],
        } as unknown as Prisma.InputJsonValue,
      },
    });

    await runHealthAndAlerts(sourceId, scrapeLog.id, completedAt, {
      eventsFound: 0,
      scrapeFailed: true,
      errors: [errorMsg],
      unmatchedTags: [],
      fillRates: { title: 0, location: 0, hares: 0, startTime: 0, runNumber: 0 },
    });

    return {
      success: false,
      scrapeLogId: scrapeLog.id,
      forced: force,
      eventsFound: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      blocked: 0,
      cancelled: 0,
      unmatched: [],
      blockedTags: [],
      errors: [errorMsg],
    };
  }
}
