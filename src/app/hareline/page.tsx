import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Hareline · HashTracks",
};
import { getOrCreateUser } from "@/lib/auth";
import { HarelineView } from "@/components/hareline/HarelineView";
import { REGION_DATA_SELECT } from "@/lib/types/region";

export default async function HarelinePage() {
  const events = await prisma.event.findMany({
    where: { status: { not: "CANCELLED" }, kennel: { isHidden: false } },
    include: {
      kennel: {
        select: { id: true, shortName: true, fullName: true, slug: true, country: true, regionRef: { select: REGION_DATA_SELECT } },
      },
    },
    orderBy: { date: "asc" },
  });

  // Get user's subscribed kennels + attendance (if authenticated)
  const user = await getOrCreateUser();
  let subscribedKennelIds: string[] = [];
  let attendanceMap: Record<string, { id: string; participationLevel: string; status: string; stravaUrl: string | null; notes: string | null }> = {};
  if (user) {
    const subscriptions = await prisma.userKennel.findMany({
      where: { userId: user.id },
      select: { kennelId: true },
    });
    subscribedKennelIds = subscriptions.map((s) => s.kennelId);

    const attendances = await prisma.attendance.findMany({
      where: { userId: user.id },
      select: { eventId: true, id: true, participationLevel: true, status: true, stravaUrl: true, notes: true },
    });
    for (const a of attendances) {
      attendanceMap[a.eventId] = {
        id: a.id,
        participationLevel: a.participationLevel as string,
        status: a.status as string,
        stravaUrl: a.stravaUrl,
        notes: a.notes,
      };
    }
  }

  // Serialize dates for client component
  const serializedEvents = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    dateUtc: e.dateUtc,
    timezone: e.timezone,
    kennelId: e.kennelId,
    kennel: { ...e.kennel, regionData: e.kennel.regionRef },
    runNumber: e.runNumber,
    title: e.title,
    haresText: e.haresText,
    startTime: e.startTime,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    description: e.description,
    sourceUrl: e.sourceUrl,
    status: e.status,
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
  }));

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold">The Hareline</h1>
        <p className="mt-1 text-muted-foreground">
          Discover upcoming and past hashing events.
        </p>
      </div>

      <Suspense>
        <HarelineView
          events={serializedEvents}
          subscribedKennelIds={subscribedKennelIds}
          isAuthenticated={!!user}
          attendanceMap={attendanceMap}
        />
      </Suspense>
    </div>
  );
}
