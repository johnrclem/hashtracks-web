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

export interface AuditResult {
  eventsScanned: number;
  findings: AuditFinding[];
  summary: Record<string, number>;
}

/** Run all audit checks on pre-queried rows. Usable by both API route and standalone script. */
export function runChecks(rows: AuditEventRow[]): { findings: AuditFinding[]; summary: Record<string, number> } {
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

  return { findings, summary };
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
