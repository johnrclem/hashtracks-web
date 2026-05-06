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
  getCloseReasonRatiosByStream,
  getRecentOpenIssues,
  getHarelinePromptInputs,
} from "./actions";
import { KNOWN_AUDIT_RULES } from "@/pipeline/audit-checks";
import { AuditDashboard } from "@/components/admin/AuditDashboard";
import { buildHarelinePrompt } from "@/lib/admin/hareline-prompt";
import { mintQueueTokens } from "@/lib/queue-snapshot-token";

/** Build the daily hareline audit prompt at request time so the curated
 *  sections (recently-fixed, focus areas) reflect live data. Returns null on
 *  failure so the dashboard hides the copy button rather than rendering empty. */
async function loadHarelinePrompt(): Promise<string | null> {
  try {
    const inputs = await getHarelinePromptInputs();
    return buildHarelinePrompt(inputs);
  } catch (err) {
    console.warn("[admin/audit] failed to build hareline prompt:", err);
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
    streamCloseReasonRatiosResult,
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
    // Coerce to `null` (not `[]`) on failure so the panel can render
    // an explicit "metric unavailable" state. Empty array would be
    // indistinguishable from a legitimate zero-activity period and
    // hide schema skew / Prisma errors during rollout.
    getCloseReasonRatiosByStream().catch(() => null),
    getRecentOpenIssues().catch(() => []),
  ]);

  // Pre-mint a queue token per candidate at page render so the dialog
  // doesn't have to round-trip a server action on open. Eliminates the
  // "Server Components render" error path from #1207 / #1216 caused by
  // intermittent failures in the on-open token mint. `mintQueueTokens`
  // returns `{}` on failure (e.g. missing secret), in which case the
  // dialog falls back to its async `getDeepDiveQueueToken` path.
  const deepDiveTokens = mintQueueTokens(
    deepDiveQueueResult.map((k) => k.kennelCode),
  );

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
      deepDiveTokens={deepDiveTokens}
      harelinePrompt={harelinePrompt}
      streamTrends={streamTrendsResult}
      streamOpenCounts={streamOpenCountsResult}
      streamCloseReasonRatios={streamCloseReasonRatiosResult}
      recentOpenIssues={recentOpenIssuesResult}
    />
  );
}
