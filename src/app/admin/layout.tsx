import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AdminNavTabs } from "@/components/admin/AdminNavTabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await getAdminUser();
  if (!admin) redirect("/");

  const [openAlertCount, pendingMismanCount, newDiscoveryCount, pendingProposalCount] = await Promise.all([
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
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Admin</h1>
      </div>

      <AdminNavTabs
        badgeCounts={{
          alerts: openAlertCount,
          misman: pendingMismanCount,
          discovery: newDiscoveryCount,
          research: pendingProposalCount,
        }}
      />

      {children}
    </div>
  );
}
