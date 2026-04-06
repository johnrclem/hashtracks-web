import { prisma } from "@/lib/db";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { getLatestAuditFindingsCount } from "@/lib/admin/audit-stats";

export default async function AdminPage() {
  // Auth is handled by the admin layout — no need to re-check here.

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));

  const [
    totalUsers,
    activeUsersResult,
    upcomingEvents,
    visibleKennels,
    enabledSources,
    healthySources,
    totalCheckins,
    activeAlerts,
    auditFindings,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(DISTINCT "userId") AS count
      FROM "Attendance"
      WHERE "createdAt" >= ${thirtyDaysAgo}
    `,
    prisma.event.count({ where: { date: { gte: today }, status: { not: "CANCELLED" }, parentEventId: null, kennel: { isHidden: false } } }),
    prisma.kennel.count({ where: { isHidden: false } }),
    prisma.source.count({ where: { enabled: true } }),
    prisma.source.count({ where: { healthStatus: "HEALTHY", enabled: true } }),
    prisma.attendance.count({ where: { status: "CONFIRMED" } }),
    prisma.alert.count({ where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } }),
    getLatestAuditFindingsCount(),
  ]);

  return (
    <AdminDashboard
      stats={{
        totalUsers,
        activeUsers: Number(activeUsersResult[0].count),
        upcomingEvents,
        visibleKennels,
        enabledSources,
        healthySources,
        totalCheckins,
        activeAlerts,
        auditFindings,
      }}
    />
  );
}
