import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  getAuditTrends,
  getTopOffenders,
  getRecentRuns,
  getSuppressions,
  getDeepDiveQueue,
  getDeepDiveCoverage,
  getStreamTrends,
  getOpenIssueCountsByStream,
  getRecentOpenIssues,
} from "./actions";
import { KNOWN_AUDIT_RULES } from "@/pipeline/audit-checks";
import { AuditDashboard } from "@/components/admin/AuditDashboard";

/** Load the daily hareline audit prompt from the markdown file at the repo root.
 *  Read at request time so edits to the doc reflect on next refresh without a redeploy.
 *  Returns null on failure (file missing, permissions) so the dashboard can hide the
 *  copy button rather than render an empty string. Errors are logged for visibility. */
async function loadHarelinePrompt(): Promise<string | null> {
  try {
    return await readFile(path.join(process.cwd(), "docs/audit-chrome-prompt.md"), "utf-8");
  } catch (err) {
    console.warn("[admin/audit] failed to load hareline prompt:", err);
    return null;
  }
}

const EMPTY_COVERAGE = { audited: 0, total: 0, percent: 0, projectedFullCycleDate: null };

export default async function AuditPage() {
  const [
    trendsResult,
    offendersResult,
    runsResult,
    suppressionsResult,
    kennels,
    deepDiveQueueResult,
    deepDiveCoverageResult,
    harelinePrompt,
    streamTrendsResult,
    streamOpenCountsResult,
    recentOpenIssuesResult,
  ] = await Promise.all([
    getAuditTrends().catch(() => []),
    getTopOffenders().catch(() => []),
    getRecentRuns().catch(() => []),
    getSuppressions().catch(() => []),
    prisma.kennel.findMany({
      select: { kennelCode: true, shortName: true },
      orderBy: { shortName: "asc" },
    }),
    getDeepDiveQueue().catch(() => []),
    getDeepDiveCoverage().catch(() => EMPTY_COVERAGE),
    loadHarelinePrompt(),
    getStreamTrends().catch(() => []),
    getOpenIssueCountsByStream().catch(() => []),
    getRecentOpenIssues().catch(() => []),
  ]);

  return (
    <AuditDashboard
      trends={trendsResult}
      topOffenders={offendersResult}
      recentRuns={runsResult}
      suppressions={suppressionsResult}
      kennels={kennels}
      knownRules={[...KNOWN_AUDIT_RULES]}
      deepDiveQueue={deepDiveQueueResult}
      deepDiveCoverage={deepDiveCoverageResult}
      harelinePrompt={harelinePrompt}
      streamTrends={streamTrendsResult}
      streamOpenCounts={streamOpenCountsResult}
      recentOpenIssues={recentOpenIssuesResult}
    />
  );
}
