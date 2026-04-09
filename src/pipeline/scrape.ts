import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import type { ErrorDetails, AiRecoverySummary, ScrapeResult, MergeResult } from "@/adapters/types";
import { hasAnyErrors } from "@/adapters/types";
import { getAdapter } from "@/adapters/registry";
import { processRawEvents } from "./merge";
import { reconcileStaleEvents } from "./reconcile";
import { computeFillRates } from "./fill-rates";
import type { FieldFillRates } from "./fill-rates";
import { analyzeHealth, persistAlerts, autoResolveCleared } from "./health";
import { autoFileIssuesForAlerts } from "./auto-issue";
import { verifyResolvedAutoFixes } from "./verify-fixes";
import { attemptAiRecovery, isAiRecoveryAvailable } from "@/lib/ai/parse-recovery";
import { validateSourceUrl } from "@/adapters/utils";
import { after } from "next/server";
import { pingIndexNow } from "@/lib/indexnow";
import { getCanonicalSiteUrl } from "@/lib/site-url";

/** Result returned by `scrapeSource()` summarizing the full scrape-merge-reconcile cycle. */
export interface ScrapeSourceResult {
  /** Whether the scrape completed without fatal errors. */
  success: boolean;
  /** ID of the ScrapeLog record created for this run. */
  scrapeLogId: string;
  /** Whether this was a forced re-scrape (all existing RawEvents deleted first). */
  forced: boolean;
  /** Total events returned by the adapter. */
  eventsFound: number;
  /** New canonical Events created by the merge pipeline. */
  created: number;
  /** Existing canonical Events updated with fresher data. */
  updated: number;
  /** RawEvents skipped because a matching fingerprint already existed. */
  skipped: number;
  /** Events blocked by the source-kennel guard (resolved but not linked). */
  blocked: number;
  /** Events cancelled by stale-event reconciliation. */
  cancelled: number;
  /** Events auto-restored from CANCELLED back to CONFIRMED. */
  restored: number;
  /** Kennel tags that could not be resolved to any known kennel. */
  unmatched: string[];
  /** Kennel tags blocked by the source-kennel mismatch guard. */
  blockedTags: string[];
  /** Error messages from scraping and/or merging. */
  errors: string[];
  /** AI parse-error recovery metrics, if recovery was attempted. */
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

    // Key cleanup by (section, row) tuple, not bare row. Multi-kennel
    // adapters (HASHREGO Step 2b, SFH3, Phoenix) emit per-section row
    // indexes that start at 0 in each section, so two unrelated parse errors
    // can share `row: 0` while belonging to different kennels. Removing by
    // bare `row` would silently drop unrecovered parse errors from other
    // sections.
    const sectionRowKey = (e: { section?: string; row: number }): string =>
      `${e.section ?? ""}:${e.row}`;
    const recoveredKeys = new Set(
      aiRecovery.results.map((r) => sectionRowKey(r.parseError)),
    );
    if (scrapeResult.errorDetails?.parse) {
      scrapeResult.errorDetails.parse = scrapeResult.errorDetails.parse.filter(
        (e) => !recoveredKeys.has(sectionRowKey(e)),
      );
    }
    const recoveredErrorPrefixes = aiRecovery.results.map(
      (r) => r.parseError.error,
    );
    const originalErrors = [...scrapeResult.errors];
    scrapeResult.errors = originalErrors.filter(
      (e) => !recoveredErrorPrefixes.some((prefix) => e === prefix || e.startsWith(prefix)),
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
  const combined: ErrorDetails = scrapeErrorDetails ? { ...scrapeErrorDetails } : {};
  if (mergeErrorDetails && mergeErrorDetails.length > 0) {
    combined.merge = mergeErrorDetails;
  }
  const hasErrors = hasAnyErrors(combined);
  return { combined, hasErrors };
}

/** Build the diagnostic context record, including AI recovery metrics. */
function buildDiagnosticContext(
  baseDiagnostics: Record<string, unknown> | undefined,
  aiRecovery: AiRecoverySummary | undefined,
): Record<string, unknown> {
  const diagnosticContext: Record<string, unknown> = baseDiagnostics ? { ...baseDiagnostics } : {};
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

/** Parameters for the ScrapeLog update after merge completes. */
interface ScrapeLogUpdateParams {
  scrapeLogId: string;
  startedAt: Date;
  scrapeResult: ScrapeResult;
  mergeResult: MergeResult;
  cancelledCount: number;
  fillRates: FieldFillRates;
  combinedErrorDetails: ErrorDetails;
  hasErrorDetails: boolean;
  diagnosticContext: Record<string, unknown>;
  fetchDurationMs: number;
  mergeDurationMs: number;
}

/** Update the ScrapeLog record with full results and quality metrics. */
async function updateScrapeLogWithResults(params: ScrapeLogUpdateParams): Promise<void> {
  const {
    scrapeLogId, startedAt, scrapeResult, mergeResult, cancelledCount,
    fillRates, combinedErrorDetails, hasErrorDetails, diagnosticContext,
    fetchDurationMs, mergeDurationMs,
  } = params;
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

/** Run health analysis, update source health, persist alerts, and auto-file GitHub issues. */
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

  const newAlertIds = new Set<string>();

  if (health.alerts.length > 0) {
    const alertIds = await persistAlerts(sourceId, scrapeLogId, health.alerts);

    for (const id of alertIds) newAlertIds.add(id);

    // Auto-file GitHub issues for newly created alerts (self-healing pipeline)
    if (alertIds.length > 0) {
      try {
        await autoFileIssuesForAlerts(sourceId, alertIds);
      } catch (err) {
        // Non-fatal: don't break the scrape pipeline if issue filing fails
        console.error("[auto-issue] Failed to auto-file issues:", err);
      }
    }
  }

  // Auto-resolve alerts whose condition has cleared on this scrape
  try {
    const candidateTypes = new Set(health.alerts.map((a) => a.type));
    // UNMATCHED_TAGS only fires for *novel* tags, but persistent unmatched tags
    // mean the condition is still active — don't auto-resolve
    if (healthInput.unmatchedTags.length > 0) {
      candidateTypes.add("UNMATCHED_TAGS");
    }
    if (healthInput.blockedTags && healthInput.blockedTags.length > 0) {
      candidateTypes.add("SOURCE_KENNEL_MISMATCH");
    }
    await autoResolveCleared(sourceId, candidateTypes, healthInput.scrapeFailed, health.checkedTypes);
  } catch (err) {
    console.error("[auto-resolve] Failed to auto-resolve cleared alerts:", err);
  }

  // Retry filing for existing OPEN alerts that were never filed (e.g., previous GITHUB_TOKEN missing)
  try {
    const unfiledAlerts = await prisma.alert.findMany({
      where: {
        sourceId,
        status: "OPEN",
        repairLog: { equals: Prisma.DbNull },
      },
      select: { id: true },
    });
    const unfiledIds = unfiledAlerts
      .map((a) => a.id)
      .filter((id) => !newAlertIds.has(id));
    if (unfiledIds.length > 0) {
      await autoFileIssuesForAlerts(sourceId, unfiledIds);
    }
  } catch (err) {
    console.error("[auto-issue] Failed to retry unfiled alerts:", err);
  }

  // Verify resolved auto-fixes: remove "pending-verification" labels from confirmed fixes
  try {
    await verifyResolvedAutoFixes(sourceId);
  } catch (err) {
    console.error("[verify-fixes] Failed to verify resolved auto-fixes:", err);
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
  const force = options?.force ?? false;

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
  });

  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }

  const days = options?.days ?? source.scrapeDays ?? 90;

  // Create ScrapeLog record
  const startedAt = new Date();
  const scrapeLog = await prisma.scrapeLog.create({
    data: {
      sourceId,
      forced: force,
    },
  });

  // Guard: mark any stale RUNNING logs for this source as FAILED.
  // Handles the case where a previous invocation was hard-killed
  // (Vercel timeout, OOM, deploy) before its catch block could run.
  try {
    const staleCleanup = await prisma.scrapeLog.updateMany({
      where: {
        sourceId,
        status: "RUNNING",
        id: { not: scrapeLog.id },
        startedAt: { lt: new Date(Date.now() - 10 * 60 * 1000) },
      },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errors: ["Marked FAILED by stale-log cleanup (previous process likely timed out)"],
      },
    });
    if (staleCleanup.count > 0) {
      console.warn(`[scrape] Cleaned up ${staleCleanup.count} stale RUNNING log(s) for source ${sourceId}`);
    }
  } catch (cleanupErr) {
    console.error("[scrape] Stale-log cleanup failed:", cleanupErr);
  }

  try {
    // SSRF prevention: validate source URL before any destructive operations.
    // GOOGLE_CALENDAR stores a calendar ID (not a URL) — the adapter constructs
    // the googleapis.com URL itself. STATIC_SCHEDULE and MANUAL have no fetch URL.
    const urlBasedTypes = ["HTML_SCRAPER", "GOOGLE_SHEETS", "ICAL_FEED", "RSS_FEED", "JSON_API", "HASHREGO", "MEETUP"];
    if (urlBasedTypes.includes(source.type)) {
      validateSourceUrl(source.url);
    }

    if (force) {
      await prisma.rawEvent.deleteMany({ where: { sourceId } });
    }

    const adapter = getAdapter(source.type, source.url, source.config as Record<string, unknown> | null);

    // For HASHREGO, load SourceKennel externalSlugs and pass to adapter.
    // Falls back to KennelDiscovery matched slugs (scoped to linked kennels) if SourceKennel has none.
    // Also capture kennel IDs to scope reconciliation to scraped kennels only.
    let kennelSlugs: string[] | undefined;
    let scrapedKennelIds: string[] | undefined;
    if (source.type === "HASHREGO") {
      const sks = await prisma.sourceKennel.findMany({
        where: { sourceId },
        select: { externalSlug: true, kennelId: true },
        orderBy: { externalSlug: "asc" },
      });
      const dbSlugs = sks
        .map((sk) => sk.externalSlug)
        .filter((slug): slug is string => slug !== null);

      if (dbSlugs.length > 0) {
        kennelSlugs = dbSlugs;
        scrapedKennelIds = sks
          .filter((sk) => sk.externalSlug !== null)
          .map((sk) => sk.kennelId);
      } else {
        // Safety fallback: use KennelDiscovery matched slugs scoped to linked kennels
        const linkedKennelIds = sks.map((sk) => sk.kennelId);
        if (linkedKennelIds.length > 0) {
          const discoveries = await prisma.kennelDiscovery.findMany({
            where: {
              externalSource: "HASHREGO",
              matchedKennelId: { in: linkedKennelIds },
            },
            select: { externalSlug: true, matchedKennelId: true },
          });
          const slugSet = new Set<string>();
          const kennelIdSet = new Set<string>();
          for (const d of discoveries) {
            slugSet.add(d.externalSlug as string);
            if (d.matchedKennelId != null) {
              kennelIdSet.add(d.matchedKennelId);
            }
          }
          if (slugSet.size > 0) {
            console.warn(
              `[scrape] HASHREGO: 0 SourceKennel slugs, falling back to ${slugSet.size} KennelDiscovery slugs`,
            );
            kennelSlugs = Array.from(slugSet);
            scrapedKennelIds = Array.from(kennelIdSet);
          }
        }
      }
    }

    const fetchStart = Date.now();
    const scrapeResult = await adapter.fetch(source, { days, kennelSlugs });
    const fetchDurationMs = Date.now() - fetchStart;

    // AI Recovery
    const aiRecovery = await runAiRecovery(scrapeResult, source.name);

    const fillRates = computeFillRates(scrapeResult.events);

    const mergeStart = Date.now();
    const mergeResult = await processRawEvents(sourceId, scrapeResult.events);
    const mergeDurationMs = Date.now() - mergeStart;

    // Reconcile stale events (scope to scraped kennels for partial-scrape adapters)
    let cancelledCount = 0;
    let reconcileContext: Record<string, unknown> | undefined;
    const rawKennelPageErrors = scrapeResult.diagnosticContext?.kennelPageFetchErrors;
    const kennelPageErrors = typeof rawKennelPageErrors === "number" && Number.isFinite(rawKennelPageErrors) ? rawKennelPageErrors : 0;
    const kennelPagesStopReason = scrapeResult.diagnosticContext?.kennelPagesStopReason;
    const kennelPagesIncomplete = typeof kennelPagesStopReason === "string" && kennelPagesStopReason !== "";
    if (
      !force &&
      scrapeResult.events.length > 0 &&
      scrapeResult.errors.length === 0 &&
      kennelPageErrors === 0 &&
      !kennelPagesIncomplete
    ) {
      const reconciled = await reconcileStaleEvents(sourceId, scrapeResult.events, days, scrapedKennelIds);
      const { cancelledEventIds: _, ...reconDiag } = reconciled;
      cancelledCount = reconciled.cancelled;
      reconcileContext = reconDiag;
      if (reconciled.cancelled > 5) {
        console.warn(
          `[scrape] High cancellation count: ${reconciled.cancelled} events cancelled ` +
          `for source "${source.name}" (${sourceId}). ` +
          `Scope: ${reconciled.kennelsInScope}/${reconciled.totalLinkedKennels} kennels.`,
        );
      }
    }

    const allErrors = [...scrapeResult.errors, ...mergeResult.eventErrorMessages];
    const { combined: combinedErrorDetails, hasErrors: hasErrorDetails } =
      buildCombinedErrorDetails(scrapeResult.errorDetails, mergeResult.mergeErrorDetails);
    const diagnosticContext = buildDiagnosticContext(scrapeResult.diagnosticContext, aiRecovery);
    if (reconcileContext) diagnosticContext.reconciliation = reconcileContext;
    if (mergeResult.restored > 0) diagnosticContext.eventsRestored = mergeResult.restored;

    await updateScrapeLogWithResults({
      scrapeLogId: scrapeLog.id, startedAt, scrapeResult, mergeResult,
      cancelledCount, fillRates, combinedErrorDetails, hasErrorDetails,
      diagnosticContext, fetchDurationMs, mergeDurationMs,
    });

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
      cancelledCount,
    });

    // Run IndexNow ping after the response is sent, so the serverless function
    // doesn't get killed mid-request. No-op when key is unset or non-prod.
    if (mergeResult.createdEventIds.length > 0) {
      const baseUrl = getCanonicalSiteUrl();
      const urls = mergeResult.createdEventIds.map((id) => `${baseUrl}/hareline/${id}`);
      after(() => pingIndexNow(urls));
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
      cancelled: cancelledCount,
      restored: mergeResult.restored,
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
      restored: 0,
      unmatched: [],
      blockedTags: [],
      errors: [errorMsg],
    };
  }
}
