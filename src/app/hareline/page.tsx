import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { HarelineView } from "@/components/hareline/HarelineView";

export default async function HarelinePage() {
  const events = await prisma.event.findMany({
    include: {
      kennel: {
        select: { id: true, shortName: true, fullName: true, slug: true, region: true },
      },
    },
    orderBy: { date: "asc" },
  });

  // Get user's subscribed kennels + attendance (if authenticated)
  const user = await getOrCreateUser();
  let subscribedKennelIds: string[] = [];
  let attendanceMap: Record<string, { id: string; participationLevel: string; stravaUrl: string | null; notes: string | null }> = {};
  if (user) {
    const subscriptions = await prisma.userKennel.findMany({
      where: { userId: user.id },
      select: { kennelId: true },
    });
    subscribedKennelIds = subscriptions.map((s) => s.kennelId);

    const attendances = await prisma.attendance.findMany({
      where: { userId: user.id },
      select: { eventId: true, id: true, participationLevel: true, stravaUrl: true, notes: true },
    });
    for (const a of attendances) {
      attendanceMap[a.eventId] = {
        id: a.id,
        participationLevel: a.participationLevel as string,
        stravaUrl: a.stravaUrl,
        notes: a.notes,
      };
    }
  }

  // Serialize dates for client component
  const serializedEvents = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    kennelId: e.kennelId,
    kennel: e.kennel,
    runNumber: e.runNumber,
    title: e.title,
    haresText: e.haresText,
    startTime: e.startTime,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    description: e.description,
    sourceUrl: e.sourceUrl,
    status: e.status,
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
