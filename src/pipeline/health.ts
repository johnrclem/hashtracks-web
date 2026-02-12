import { prisma } from "@/lib/db";
import type { SourceHealth, AlertType, AlertSeverity, Prisma } from "@/generated/prisma/client";
import type { FieldFillRates } from "./fill-rates";

interface AlertCandidate {
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  details: string;
  context?: Record<string, unknown>;
}

export interface HealthAnalysis {
  healthStatus: SourceHealth;
  alerts: AlertCandidate[];
}

interface AnalyzeInput {
  eventsFound: number;
  scrapeFailed: boolean;
  errors: string[];
  unmatchedTags: string[];
  fillRates: FieldFillRates;
  structureHash?: string;
}

/**
 * Analyze scrape health using rolling-window comparison against recent scrape history.
 * Returns a health status and any alerts to create.
 */
export async function analyzeHealth(
  sourceId: string,
  scrapeLogId: string,
  input: AnalyzeInput,
): Promise<HealthAnalysis> {
  const alerts: AlertCandidate[] = [];

  // Fetch last 10 successful scrapes for baseline (excluding current)
  const recentSuccessful = await prisma.scrapeLog.findMany({
    where: { sourceId, status: "SUCCESS", id: { not: scrapeLogId } },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      eventsFound: true,
      unmatchedTags: true,
      fillRateTitle: true,
      fillRateLocation: true,
      fillRateHares: true,
      fillRateStartTime: true,
      fillRateRunNumber: true,
      structureHash: true,
    },
  });

  // Fetch last 3 scrapes (any status) for consecutive failure check
  const recentAll = await prisma.scrapeLog.findMany({
    where: { sourceId, id: { not: scrapeLogId } },
    orderBy: { startedAt: "desc" },
    take: 3,
    select: { status: true },
  });

  // ── 1. Scrape failure ──
  if (input.scrapeFailed) {
    alerts.push({
      type: "SCRAPE_FAILURE",
      severity: "WARNING",
      title: "Scrape failed",
      details: input.errors.slice(0, 5).join("; "),
      context: { errorMessages: input.errors.slice(0, 10), consecutiveCount: 1 },
    });
  }

  // ── 2. Consecutive failures ──
  if (input.scrapeFailed) {
    const prevFailures = recentAll.filter((l) => l.status === "FAILED").length;
    if (prevFailures >= 2) {
      alerts.push({
        type: "CONSECUTIVE_FAILURES",
        severity: "CRITICAL",
        title: `${prevFailures + 1} consecutive scrape failures`,
        details:
          "Multiple consecutive scrapes have failed. The source may be down or its format may have changed.",
        context: { errorMessages: input.errors.slice(0, 10), consecutiveCount: prevFailures + 1 },
      });
    }
  }

  // Skip trend checks if scrape failed (no event data to compare)
  if (!input.scrapeFailed && recentSuccessful.length > 0) {
    // ── 3. Event count anomaly ──
    const avgEvents =
      recentSuccessful.reduce((sum, l) => sum + l.eventsFound, 0) /
      recentSuccessful.length;

    if (input.eventsFound === 0 && avgEvents > 0) {
      alerts.push({
        type: "EVENT_COUNT_ANOMALY",
        severity: "CRITICAL",
        title: "Zero events found",
        details: `Expected ~${Math.round(avgEvents)} events based on rolling average of last ${recentSuccessful.length} scrapes, but found 0.`,
        context: { currentCount: 0, baselineAvg: Math.round(avgEvents), baselineWindow: recentSuccessful.length, dropPercent: 100 },
      });
    } else if (
      avgEvents > 5 &&
      input.eventsFound < avgEvents * 0.5
    ) {
      const dropPct = Math.round(
        ((avgEvents - input.eventsFound) / avgEvents) * 100,
      );
      alerts.push({
        type: "EVENT_COUNT_ANOMALY",
        severity: "WARNING",
        title: `Event count dropped ${dropPct}%`,
        details: `Found ${input.eventsFound} events vs rolling average of ${Math.round(avgEvents)} (last ${recentSuccessful.length} scrapes).`,
        context: { currentCount: input.eventsFound, baselineAvg: Math.round(avgEvents), baselineWindow: recentSuccessful.length, dropPercent: dropPct },
      });
    }

    // ── 4. Field fill rate drops ──
    const fillFields = [
      { key: "title" as const, dbKey: "fillRateTitle" as const },
      { key: "location" as const, dbKey: "fillRateLocation" as const },
      { key: "hares" as const, dbKey: "fillRateHares" as const },
      { key: "startTime" as const, dbKey: "fillRateStartTime" as const },
      { key: "runNumber" as const, dbKey: "fillRateRunNumber" as const },
    ];

    for (const { key, dbKey } of fillFields) {
      const recentRates = recentSuccessful
        .map((l) => l[dbKey])
        .filter((v): v is number => v != null);

      if (recentRates.length === 0) continue;

      const avgRate =
        recentRates.reduce((sum, v) => sum + v, 0) / recentRates.length;
      const currentRate = input.fillRates[key];

      // Only alert if avg was above 50% (avoid noise on always-sparse fields)
      // and current dropped by more than 30 percentage points
      if (avgRate >= 50 && avgRate - currentRate > 30) {
        alerts.push({
          type: "FIELD_FILL_DROP",
          severity: "WARNING",
          title: `${key} fill rate dropped from ${Math.round(avgRate)}% to ${currentRate}%`,
          details: `The "${key}" field was populated in ~${Math.round(avgRate)}% of events on average but is now at ${currentRate}%.`,
          context: { field: key, currentRate, baselineAvg: Math.round(avgRate) },
        });
      }
    }

    // ── 5. Structural change detection ──
    if (input.structureHash) {
      const prevHash = recentSuccessful.find(
        (l) => l.structureHash,
      )?.structureHash;
      if (prevHash && prevHash !== input.structureHash) {
        alerts.push({
          type: "STRUCTURE_CHANGE",
          severity: "WARNING",
          title: "HTML structure changed",
          details: `Structural fingerprint changed from ${prevHash.slice(0, 12)}... to ${input.structureHash.slice(0, 12)}.... The site template may have been updated.`,
          context: { previousHash: prevHash, currentHash: input.structureHash },
        });
      }
    }

    // ── 6. New unmatched kennel tags ──
    if (input.unmatchedTags.length > 0) {
      const prevUnmatched = new Set(
        recentSuccessful.flatMap((l) => l.unmatchedTags),
      );
      const novelTags = input.unmatchedTags.filter(
        (t) => !prevUnmatched.has(t),
      );
      if (novelTags.length > 0) {
        alerts.push({
          type: "UNMATCHED_TAGS",
          severity: "INFO",
          title: `${novelTags.length} new unmatched kennel tag${novelTags.length !== 1 ? "s" : ""}`,
          details: `New tags: ${novelTags.join(", ")}. These need alias mapping in the kennel resolver.`,
          context: { tags: novelTags },
        });
      }
    }
  }

  // ── Determine overall health status ──
  let healthStatus: SourceHealth;
  const hasCritical = alerts.some((a) => a.severity === "CRITICAL");
  const hasWarning = alerts.some((a) => a.severity === "WARNING");

  if (input.scrapeFailed || hasCritical) {
    healthStatus = "FAILING";
  } else if (hasWarning) {
    healthStatus = "DEGRADED";
  } else {
    healthStatus = "HEALTHY";
  }

  return { healthStatus, alerts };
}

/**
 * Persist alerts from health analysis, deduplicating against existing open alerts.
 */
export async function persistAlerts(
  sourceId: string,
  scrapeLogId: string,
  alertCandidates: AlertCandidate[],
): Promise<void> {
  for (const candidate of alertCandidates) {
    // Check for existing open/acknowledged alert of same type
    const existing = await prisma.alert.findFirst({
      where: {
        sourceId,
        type: candidate.type,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
      },
    });

    if (existing) {
      // Update existing alert with latest details
      await prisma.alert.update({
        where: { id: existing.id },
        data: {
          details: candidate.details,
          severity: candidate.severity,
          scrapeLogId,
          ...(candidate.context ? { context: candidate.context as Prisma.InputJsonValue } : {}),
        },
      });
      continue;
    }

    // Check for snoozed alert — re-open if snooze expired
    const snoozed = await prisma.alert.findFirst({
      where: {
        sourceId,
        type: candidate.type,
        status: "SNOOZED",
      },
    });

    if (snoozed) {
      if (snoozed.snoozedUntil && snoozed.snoozedUntil < new Date()) {
        // Snooze expired — re-open
        await prisma.alert.update({
          where: { id: snoozed.id },
          data: {
            status: "OPEN",
            details: candidate.details,
            severity: candidate.severity,
            scrapeLogId,
            snoozedUntil: null,
            ...(candidate.context ? { context: candidate.context as Prisma.InputJsonValue } : {}),
          },
        });
      }
      // Still snoozed — skip
      continue;
    }

    // Create new alert
    await prisma.alert.create({
      data: {
        sourceId,
        scrapeLogId,
        type: candidate.type,
        severity: candidate.severity,
        title: candidate.title,
        details: candidate.details,
        ...(candidate.context ? { context: candidate.context as Prisma.InputJsonValue } : {}),
      },
    });
  }
}
