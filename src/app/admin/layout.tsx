import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { getLatestAuditFindingsCount } from "@/lib/admin/audit-stats";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  const [openAlertCount, pendingMismanCount, newDiscoveryCount, pendingProposalCount, auditFindings] = await Promise.all([
    prisma.alert.count({
      where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    }),
    prisma.mismanRequest.count({
      where: { status: "PENDING" },
    }),
    prisma.kennelDiscovery.count({
      where: { status: "NEW" },
    }),
    prisma.sourceProposal.count({
      where: { status: "PENDING" },
    }),
    getLatestAuditFindingsCount(),
  ]);

  return (
    <div className="flex gap-6">
      <AdminSidebar
        badgeCounts={{
          alerts: openAlertCount,
          misman: pendingMismanCount,
          discovery: newDiscoveryCount,
          research: pendingProposalCount,
          audit: auditFindings,
        }}
      />

      <main className="min-w-0 flex-1 py-2">
        {children}
      </main>
    </div>
  );
}
