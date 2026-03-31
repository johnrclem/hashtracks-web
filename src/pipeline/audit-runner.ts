/**
 * Shared audit orchestration — queries upcoming events and runs all audit checks.
 * Used by both the API route (Vercel) and the local script.
 */
import { prisma } from "@/lib/db";
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
    const key = `${f.kennelShortName}::${f.rule}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { findings: [] };
      map.set(key, entry);
    }
    entry.findings.push(f);
  }

  const groups: AuditGroup[] = [...map.values()].map(({ findings: fs }) => ({
    kennelShortName: fs[0].kennelShortName,
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

/** Run all audit checks on pre-queried rows. Usable by both API route and standalone script. */
export function runChecks(rows: AuditEventRow[]): Omit<AuditResult, "eventsScanned"> {
  const findings: AuditFinding[] = [];
  for (const row of rows) {
    findings.push(...checkHareQuality(row), ...checkTitleQuality(row));
  }
  findings.push(
    ...checkLocationQuality(rows),
    ...checkEventQuality(rows),
    ...checkDescriptionQuality(rows),
  );

  const summary: Record<string, number> = {};
  for (const f of findings) {
    summary[f.category] = (summary[f.category] ?? 0) + 1;
  }

  const { groups, topGroups } = groupAndRank(findings);

  return { findings, groups, topGroups, summary };
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

  return { eventsScanned: events.length, ...runChecks(rows) };
}
