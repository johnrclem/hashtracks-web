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
  blockedTags?: string[];
  fillRates: FieldFillRates;
  structureHash?: string;
}

/** Type alias for the shape of recent scrape log rows used across checks. */
type RecentLog = {
  eventsFound: number;
  unmatchedTags: string[];
  fillRateTitle: number | null;
  fillRateLocation: number | null;
  fillRateHares: number | null;
  fillRateStartTime: number | null;
  fillRateRunNumber: number | null;
  structureHash: string | null;
};

// ── Individual health checks ──

function checkScrapeFailure(input: AnalyzeInput): AlertCandidate | null {
  if (!input.scrapeFailed) return null;
  return {
    type: "SCRAPE_FAILURE",
    severity: "WARNING",
    title: "Scrape failed",
    details: input.errors.slice(0, 5).join("; "),
    context: { errorMessages: input.errors.slice(0, 10), consecutiveCount: 1 },
  };
}

function checkConsecutiveFailures(
  input: AnalyzeInput,
  recentAll: { status: string }[],
): AlertCandidate | null {
  if (!input.scrapeFailed) return null;
  const prevFailures = recentAll.filter((l) => l.status === "FAILED").length;
  if (prevFailures < 2) return null;
  return {
    type: "CONSECUTIVE_FAILURES",
    severity: "CRITICAL",
    title: `${prevFailures + 1} consecutive scrape failures`,
    details:
      "Multiple consecutive scrapes have failed. The source may be down or its format may have changed.",
    context: { errorMessages: input.errors.slice(0, 10), consecutiveCount: prevFailures + 1 },
  };
}

function checkEventCountAnomaly(
  input: AnalyzeInput,
  recentSuccessful: RecentLog[],
): AlertCandidate | null {
  const avgEvents =
    recentSuccessful.reduce((sum, l) => sum + l.eventsFound, 0) /
    recentSuccessful.length;

  if (input.eventsFound === 0 && avgEvents > 0) {
    return {
      type: "EVENT_COUNT_ANOMALY",
      severity: "CRITICAL",
      title: "Zero events found",
      details: `Expected ~${Math.round(avgEvents)} events based on rolling average of last ${recentSuccessful.length} scrapes, but found 0.`,
      context: { currentCount: 0, baselineAvg: Math.round(avgEvents), baselineWindow: recentSuccessful.length, dropPercent: 100 },
    };
  }

  if (avgEvents > 5 && input.eventsFound < avgEvents * 0.5) {
    const dropPct = Math.round(
      ((avgEvents - input.eventsFound) / avgEvents) * 100,
    );
    return {
      type: "EVENT_COUNT_ANOMALY",
      severity: "WARNING",
      title: `Event count dropped ${dropPct}%`,
      details: `Found ${input.eventsFound} events vs rolling average of ${Math.round(avgEvents)} (last ${recentSuccessful.length} scrapes).`,
      context: { currentCount: input.eventsFound, baselineAvg: Math.round(avgEvents), baselineWindow: recentSuccessful.length, dropPercent: dropPct },
    };
  }

  return null;
}

function checkFieldFillDrops(
  input: AnalyzeInput,
  recentSuccessful: RecentLog[],
): AlertCandidate[] {
  const alerts: AlertCandidate[] = [];
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

  return alerts;
}

async function checkStructuralChange(
  sourceId: string,
  input: AnalyzeInput,
  recentSuccessful: RecentLog[],
): Promise<AlertCandidate | null> {
  if (!input.structureHash) return null;

  const prevHash = recentSuccessful.find(
    (l) => l.structureHash,
  )?.structureHash;

  if (prevHash && prevHash === input.structureHash) {
    // Hash is stable — auto-resolve any open STRUCTURE_CHANGE alerts
    await autoResolveStructureAlerts(sourceId);
    return null;
  }

  if (!prevHash || prevHash === input.structureHash) return null;

  // Compute quality impact by comparing current metrics to baseline
  const prevEventCount = Math.round(
    recentSuccessful.reduce((sum, l) => sum + l.eventsFound, 0) /
      recentSuccessful.length,
  );
  const fillRateBaseline = {
    title: avgFillRate(recentSuccessful, "fillRateTitle"),
    location: avgFillRate(recentSuccessful, "fillRateLocation"),
    hares: avgFillRate(recentSuccessful, "fillRateHares"),
    startTime: avgFillRate(recentSuccessful, "fillRateStartTime"),
    runNumber: avgFillRate(recentSuccessful, "fillRateRunNumber"),
  };

  const eventCountDropPct =
    prevEventCount > 0
      ? Math.round(((prevEventCount - input.eventsFound) / prevEventCount) * 100)
      : 0;
  const maxFillDrop = Math.max(
    ...Object.entries(fillRateBaseline).map(([key, baseline]) => {
      const current = input.fillRates[key as keyof typeof input.fillRates];
      return baseline >= 50 ? baseline - current : 0;
    }),
  );
  const qualityImpacted = eventCountDropPct > 20 || maxFillDrop > 15;

  return {
    type: "STRUCTURE_CHANGE",
    severity: qualityImpacted ? "WARNING" : "INFO",
    title: qualityImpacted
      ? "HTML structure changed — data quality may be affected"
      : "HTML structure changed (no impact on data quality)",
    details: qualityImpacted
      ? `Structural fingerprint changed and scrape quality has degraded. Event count: ${prevEventCount} → ${input.eventsFound}. Investigate the source page for template changes.`
      : `Structural fingerprint changed but event extraction is working normally. Event count: ${prevEventCount} → ${input.eventsFound}.`,
    context: {
      previousHash: prevHash,
      currentHash: input.structureHash,
      previousEventCount: prevEventCount,
      currentEventCount: input.eventsFound,
      fillRateBaseline,
      fillRateCurrent: input.fillRates,
      qualityImpacted,
    },
  };
}

function checkUnmatchedTags(
  input: AnalyzeInput,
  recentSuccessful: RecentLog[],
): AlertCandidate | null {
  if (input.unmatchedTags.length === 0) return null;

  const prevUnmatched = new Set(
    recentSuccessful.flatMap((l) => l.unmatchedTags),
  );
  const novelTags = input.unmatchedTags.filter(
    (t) => !prevUnmatched.has(t),
  );
  if (novelTags.length === 0) return null;

  return {
    type: "UNMATCHED_TAGS",
    severity: "INFO",
    title: `${novelTags.length} new unmatched kennel tag${novelTags.length !== 1 ? "s" : ""}`,
    details: `New tags: ${novelTags.join(", ")}. These need alias mapping in the kennel resolver.`,
    context: { tags: novelTags },
  };
}

function checkSourceKennelMismatches(
  input: AnalyzeInput,
): AlertCandidate | null {
  if (!input.blockedTags || input.blockedTags.length === 0) return null;
  return {
    type: "SOURCE_KENNEL_MISMATCH",
    severity: "WARNING",
    title: `${input.blockedTags.length} kennel tag${input.blockedTags.length !== 1 ? "s" : ""} blocked: not linked to source`,
    details: `Tags [${input.blockedTags.join(", ")}] resolved to valid kennels but are not in this source's SourceKennel links.`,
    context: { tags: input.blockedTags },
  };
}

// ── Main analysis orchestrator ──

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

  // 1. Scrape failure
  const failureAlert = checkScrapeFailure(input);
  if (failureAlert) alerts.push(failureAlert);

  // 2. Consecutive failures
  const consecutiveAlert = checkConsecutiveFailures(input, recentAll);
  if (consecutiveAlert) alerts.push(consecutiveAlert);

  // Trend checks require baseline data and a successful scrape
  if (!input.scrapeFailed && recentSuccessful.length > 0) {
    // 3. Event count anomaly
    const countAlert = checkEventCountAnomaly(input, recentSuccessful);
    if (countAlert) alerts.push(countAlert);

    // 4. Field fill rate drops
    alerts.push(...checkFieldFillDrops(input, recentSuccessful));

    // 5. Structural change detection
    const structureAlert = await checkStructuralChange(sourceId, input, recentSuccessful);
    if (structureAlert) alerts.push(structureAlert);

    // 6. New unmatched kennel tags
    const unmatchedAlert = checkUnmatchedTags(input, recentSuccessful);
    if (unmatchedAlert) alerts.push(unmatchedAlert);
  }

  // 7. Source-kennel mismatches (always check, even without baseline)
  const mismatchAlert = checkSourceKennelMismatches(input);
  if (mismatchAlert) alerts.push(mismatchAlert);

  // Determine overall health status
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

/** Compute average fill rate from recent scrape logs for a given field. */
function avgFillRate(
  logs: RecentLog[],
  field: "fillRateTitle" | "fillRateLocation" | "fillRateHares" | "fillRateStartTime" | "fillRateRunNumber",
): number {
  const rates = logs.map((l) => l[field]).filter((v): v is number => v != null);
  if (rates.length === 0) return 0;
  return Math.round(rates.reduce((sum, v) => sum + v, 0) / rates.length);
}

/** Auto-resolve open STRUCTURE_CHANGE alerts when structure hash stabilizes. */
async function autoResolveStructureAlerts(sourceId: string): Promise<void> {
  const openAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: "STRUCTURE_CHANGE",
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
    },
  });

  for (const alert of openAlerts) {
    await prisma.alert.update({
      where: { id: alert.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        details: (alert.details ?? "") + " [Auto-resolved: structure stabilized on subsequent scrape]",
      },
    });
  }
}
