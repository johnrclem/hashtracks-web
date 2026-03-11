import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ChartNoAxesColumn } from "lucide-react";
import { getOrCreateUser } from "@/lib/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { prisma } from "@/lib/db";
import { LogbookList } from "@/components/logbook/LogbookList";
import { LogbookStatsCards } from "@/components/logbook/LogbookStatsCards";
import { PendingConfirmations } from "@/components/logbook/PendingConfirmations";
import { PendingLinkRequests } from "@/components/logbook/PendingLinkRequests";
import { StravaNudgeBanner } from "@/components/logbook/StravaNudgeBanner";
import { getStravaConnection } from "@/app/strava/actions";

export const metadata: Metadata = {
  title: "My Logbook · HashTracks",
};

export default async function LogbookPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const [attendances, stravaResult] = await Promise.all([
    prisma.attendance.findMany({
      where: { userId: user.id, status: { in: ["CONFIRMED", "INTENDING"] } },
      include: {
        event: {
          include: {
            kennel: {
              select: { id: true, shortName: true, fullName: true, slug: true, region: true },
            },
          },
        },
      },
      orderBy: { event: { date: "desc" } },
    }),
    getStravaConnection(),
  ]);

  const stravaConnected = stravaResult.success ? stravaResult.connected : false;

  const entries = attendances.map((a) => ({
      attendance: {
        id: a.id,
        participationLevel: a.participationLevel as string,
        status: a.status as string,
        stravaUrl: a.stravaUrl,
        notes: a.notes,
      },
      event: {
        id: a.event.id,
        date: a.event.date.toISOString(),
        runNumber: a.event.runNumber,
        title: a.event.title,
        startTime: a.event.startTime,
        status: a.event.status,
        kennel: a.event.kennel,
      },
    }));

  const confirmedEntries = entries.filter((e) => e.attendance.status === "CONFIRMED");
  const confirmedCount = confirmedEntries.length;
  const totalHares = confirmedEntries.filter(
    (e) => e.attendance.participationLevel === "HARE",
  ).length;
  const uniqueKennels = new Set(
    confirmedEntries.map((e) => e.event.kennel.id),
  ).size;
  const now = new Date();
  const todayUtcNoon = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
  const goingCount = entries.filter(
    (e) => e.attendance.status === "INTENDING" && new Date(e.event.date).getTime() > todayUtcNoon
  ).length;

  return (
    <div className="min-w-0">
      <PageHeader
        title="My Logbook"
        description={`${confirmedCount} ${confirmedCount === 1 ? "run" : "runs"} logged${goingCount > 0 ? ` · ${goingCount} upcoming` : ""}`}
        actions={
          <Link
            href="/logbook/stats"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <ChartNoAxesColumn size={14} />
            View Stats
          </Link>
        }
      />

      {/* Inline stats cards */}
      {confirmedCount > 0 && (
        <LogbookStatsCards
          totalRuns={confirmedCount}
          totalHares={totalHares}
          uniqueKennels={uniqueKennels}
        />
      )}

      <div className="mt-6 space-y-6">
        <PendingLinkRequests />
        <PendingConfirmations />
        <StravaNudgeBanner stravaConnected={stravaConnected} />
        <LogbookList entries={entries} stravaConnected={stravaConnected} />
      </div>
    </div>
  );
}
