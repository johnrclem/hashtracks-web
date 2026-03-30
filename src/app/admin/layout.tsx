import { getAdminUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { AdminNavTabs } from "@/components/admin/AdminNavTabs";
import { Shield } from "lucide-react";
import { FadeInSection } from "@/components/home/HeroAnimations";

export const dynamic = "force-dynamic";

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
      {/* Header with gradient orb */}
      <div className="relative">
        <div className="pointer-events-none absolute inset-0 -mx-4 overflow-hidden">
          <div className="absolute -top-40 right-0 h-[30rem] w-[40rem] rounded-full bg-slate-500/10 blur-3xl" />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-500/20 bg-slate-500/[0.06] px-4 py-1.5">
            <Shield className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400/90">
              Administration
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
            Admin
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage sources, kennels, regions, alerts, and access control.
          </p>
        </div>
      </div>

      <AdminNavTabs
        badgeCounts={{
          alerts: openAlertCount,
          misman: pendingMismanCount,
          discovery: newDiscoveryCount,
          research: pendingProposalCount,
        }}
      />

      <FadeInSection>
        {children}
      </FadeInSection>
    </div>
  );
}
