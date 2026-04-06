import { prisma } from "@/lib/db";
import {
  getAuditTrends,
  getTopOffenders,
  getRecentRuns,
  getSuppressions,
  getDeepDiveQueue,
  getDeepDiveCoverage,
} from "./actions";
import { KNOWN_AUDIT_RULES } from "@/pipeline/audit-checks";
import { AuditDashboard } from "@/components/admin/AuditDashboard";

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
    />
  );
}
