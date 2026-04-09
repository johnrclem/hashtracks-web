/**
 * Shared audit orchestration — queries upcoming events and runs all audit checks.
 * Used by both the API route (Vercel) and the local script.
 */
import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  checkHareQuality,
  checkTitleQuality,
  checkLocationQuality,
  checkEventQuality,
  checkDescriptionQuality,
  type AuditEventRow,
  type AuditFinding,
} from "./audit-checks";

/** A group of related findings (same kennel + same rule). */
export interface AuditGroup {
  kennelShortName: string;
  kennelCode: string;
  rule: string;
  category: AuditFinding["category"];
  severity: AuditFinding["severity"];
  adapterType: string;
  count: number;
  sampleFindings: AuditFinding[];  // up to 3 samples with event URLs
}

export interface AuditResult {
  eventsScanned: number;
  findings: AuditFinding[];
  groups: AuditGroup[];     // deduped + ranked
  topGroups: AuditGroup[];  // top 3 by severity then count
  summary: Record<string, number>;
}

const SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1 };
const MAX_TOP_GROUPS = 3;
const MAX_SAMPLES_PER_GROUP = 3;

/** Group findings by kennel+rule, rank by severity then count. */
function groupAndRank(findings: AuditFinding[]): { groups: AuditGroup[]; topGroups: AuditGroup[] } {
  const map = new Map<string, { findings: AuditFinding[] }>();
  for (const f of findings) {
    const key = `${f.kennelCode}::${f.rule}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { findings: [] };
      map.set(key, entry);
    }
    entry.findings.push(f);
  }

  const groups: AuditGroup[] = [...map.values()].map(({ findings: fs }) => ({
    kennelShortName: fs[0].kennelShortName,
    kennelCode: fs[0].kennelCode,
    rule: fs[0].rule,
    category: fs[0].category,
    severity: fs[0].severity,
    adapterType: fs[0].adapterType,
    count: fs.length,
    sampleFindings: fs.slice(0, MAX_SAMPLES_PER_GROUP),
  }));

  groups.sort((a, b) => {
    const sevDiff = (SEVERITY_RANK[a.severity] ?? 2) - (SEVERITY_RANK[b.severity] ?? 2);
    return sevDiff !== 0 ? sevDiff : b.count - a.count;
  });

  return { groups, topGroups: groups.slice(0, MAX_TOP_GROUPS) };
}

/** Load active suppressions from the database as `${kennelCode}::${rule}` keys (or `::${rule}` for global). */
export async function loadSuppressions(): Promise<Set<string>> {
  const rows = await prisma.auditSuppression.findMany({
    select: { kennelCode: true, rule: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    keys.add(`${r.kennelCode ?? ""}::${r.rule}`);
  }
  return keys;
}

/** Check if a finding is suppressed (matches by kennelCode or global). */
export function isSuppressed(f: AuditFinding, suppressions: Set<string>): boolean {
  return suppressions.has(`${f.kennelCode}::${f.rule}`) || suppressions.has(`::${f.rule}`);
}

/** Compute category summary counts from findings. */
export function computeSummary(findings: AuditFinding[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const f of findings) {
    summary[f.category] = (summary[f.category] ?? 0) + 1;
  }
  return summary;
}

/** Run all audit checks on pre-queried rows. Returns raw findings (no grouping — caller groups after filtering). */
export function runChecks(rows: AuditEventRow[]): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const row of rows) {
    findings.push(...checkHareQuality(row), ...checkTitleQuality(row));
  }
  findings.push(
    ...checkLocationQuality(rows),
    ...checkEventQuality(rows),
    ...checkDescriptionQuality(rows),
  );
  return findings;
}

export async function runAudit(): Promise<AuditResult> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 90);

  const events = await prisma.event.findMany({
    where: {
      date: { gte: cutoffDate, lte: futureDate },
      status: "CONFIRMED",
    },
    select: {
      id: true,
      title: true,
      haresText: true,
      description: true,
      locationName: true,
      locationCity: true,
      startTime: true,
      runNumber: true,
      date: true,
      sourceUrl: true,
      kennel: { select: { shortName: true, kennelCode: true } },
      rawEvents: {
        take: 1,
        orderBy: [{ scrapedAt: "desc" }],
        select: {
          rawData: true,
          source: { select: { type: true, scrapeDays: true } },
        },
      },
    },
  });

  const rows = events.map(e => ({
    id: e.id,
    kennelShortName: e.kennel.shortName,
    kennelCode: e.kennel.kennelCode,
    haresText: e.haresText,
    title: e.title,
    description: e.description,
    locationName: e.locationName,
    locationCity: e.locationCity,
    startTime: e.startTime,
    runNumber: e.runNumber,
    date: e.date.toISOString().split("T")[0],
    sourceUrl: e.sourceUrl,
    sourceType: e.rawEvents[0]?.source?.type ?? "UNKNOWN",
    scrapeDays: e.rawEvents[0]?.source?.scrapeDays ?? 90,
    rawDescription: (e.rawEvents[0]?.rawData as Record<string, unknown>)?.description as string | null ?? null,
  }));

  const allFindings = runChecks(rows);

  // Filter out suppressed findings, then group and rank once
  const suppressions = await loadSuppressions();
  const findings = allFindings.filter(f => !isSuppressed(f, suppressions));
  const summary = computeSummary(findings);
  const { groups, topGroups } = groupAndRank(findings);

  return { eventsScanned: events.length, findings, groups, topGroups, summary };
}

/** Persist audit results to the AuditLog table for trend tracking. */
export async function persistAuditLog(
  result: AuditResult,
  issuesFiled: number,
  type: "HARELINE" | "KENNEL_DEEP_DIVE" = "HARELINE",
  kennelCode?: string,
): Promise<string> {
  const log = await prisma.auditLog.create({
    data: {
      type,
      eventsScanned: result.eventsScanned,
      findingsCount: result.findings.length,
      groupsCount: result.groups.length,
      issuesFiled,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      summary: result.summary as unknown as Prisma.InputJsonValue,
      kennelCode: kennelCode ?? null,
    },
  });
  return log.id;
}

/** Update issuesFiled count on an existing audit log row. Failures are logged but not thrown. */
export async function updateAuditLogIssuesFiled(logId: string, issuesFiled: number): Promise<void> {
  try {
    await prisma.auditLog.update({ where: { id: logId }, data: { issuesFiled } });
  } catch (err) {
    console.error("[audit-runner] Failed to update AuditLog issuesFiled:", err);
  }
}
