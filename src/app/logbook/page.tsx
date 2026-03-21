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
import { StravaSuggestions } from "@/components/logbook/StravaSuggestions";
import { AddRunButton } from "@/components/logbook/AddRunButton";
import { LogbookOnboarding, StravaConnectBanner, QuickStartGuide } from "@/components/logbook/LogbookOnboarding";
import { getStravaConnection } from "@/app/strava/actions";
import { getTodayUtcNoon } from "@/lib/date";

const ONBOARDING_RUN_THRESHOLD = 20;

export const metadata: Metadata = {
  title: "My Logbook · HashTracks",
};

export default async function LogbookPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const [attendances, stravaResult, allRegions] = await Promise.all([
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
    prisma.region.findMany({
      where: { level: "METRO" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const stravaConnected = stravaResult.success ? stravaResult.connected : false;
  const stravaLastSyncAt = stravaResult.success ? stravaResult.lastSyncAt : undefined;

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
  const todayUtcNoon = getTodayUtcNoon();
  const goingCount = entries.filter(
    (e) => e.attendance.status === "INTENDING" && new Date(e.event.date).getTime() > todayUtcNoon
  ).length;

  const description = `${confirmedCount} ${confirmedCount === 1 ? "run" : "runs"} logged${
    goingCount > 0 ? ` · ${goingCount} upcoming` : ""
  }`;

  // ─── Tier 1: Zero confirmed runs ─────────────────────────────────
  if (confirmedCount === 0 && goingCount === 0) {
    return (
      <div className="min-w-0">
        <PageHeader
          title="My Logbook"
          description={description}
          actions={
            <div className="flex items-center gap-2">
              <AddRunButton />
            </div>
          }
        />
        <div className="mt-6">
          <LogbookOnboarding stravaConnected={stravaConnected} />
        </div>
      </div>
    );
  }

  if (confirmedCount === 0 && goingCount > 0) {
    return (
      <div className="min-w-0">
        <PageHeader
          title="My Logbook"
          description={description}
          actions={
            <div className="flex items-center gap-2">
              <AddRunButton />
            </div>
          }
        />
        <div className="mt-6 space-y-6">
          <LogbookOnboarding stravaConnected={stravaConnected} />
          <LogbookList entries={entries} stravaConnected={stravaConnected} allRegions={allRegions} />
        </div>
      </div>
    );
  }

  // ─── Tier 2-4: Has confirmed runs ──────────────────────────────
  return (
    <div className="min-w-0">
      <PageHeader
        title="My Logbook"
        description={description}
        actions={
          <div className="flex items-center gap-2">
            <AddRunButton />
            <Link
              href="/logbook/stats"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
            >
              <ChartNoAxesColumn size={14} />
              View Stats
            </Link>
          </div>
        }
      />

      {/* Inline stats cards */}
      <LogbookStatsCards
        totalRuns={confirmedCount}
        totalHares={totalHares}
        uniqueKennels={uniqueKennels}
      />

      <div className="mt-6 space-y-6">
        {!stravaConnected && confirmedCount < ONBOARDING_RUN_THRESHOLD && <StravaConnectBanner />}
        <PendingLinkRequests />
        <PendingConfirmations />
        <StravaSuggestions stravaConnected={stravaConnected} lastSyncAt={stravaLastSyncAt} />
        <LogbookList entries={entries} stravaConnected={stravaConnected} allRegions={allRegions} />
        {confirmedCount < ONBOARDING_RUN_THRESHOLD && <QuickStartGuide />}
      </div>
    </div>
  );
}
