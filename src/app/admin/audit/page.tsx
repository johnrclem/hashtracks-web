import { prisma } from "@/lib/db";
import {
  getAuditTrends,
  getTopOffenders,
  getRecentRuns,
  getSuppressions,
  KNOWN_AUDIT_RULES,
} from "./actions";
import { AuditDashboard } from "@/components/admin/AuditDashboard";

export default async function AuditPage() {
  const [trendsResult, offendersResult, runsResult, suppressionsResult, kennels] =
    await Promise.all([
      getAuditTrends().catch(() => []),
      getTopOffenders().catch(() => []),
      getRecentRuns().catch(() => []),
      getSuppressions().catch(() => []),
      prisma.kennel.findMany({
        select: { kennelCode: true, shortName: true },
        orderBy: { shortName: "asc" },
      }),
    ]);

  return (
    <AuditDashboard
      trends={trendsResult}
      topOffenders={offendersResult}
      recentRuns={runsResult}
      suppressions={suppressionsResult}
      kennels={kennels}
      knownRules={[...KNOWN_AUDIT_RULES]}
    />
  );
}
