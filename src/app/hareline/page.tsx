import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { getWeatherForEvents } from "@/lib/weather";
import { getOrCreateUser } from "@/lib/auth";
import { regionAbbrev } from "@/lib/region";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const regions = typeof params.regions === "string" ? params.regions.split(",") : [];
  if (regions.length === 1) {
    return { title: `${regionAbbrev(regions[0])} Runs | HashTracks` };
  }
  return { title: "Hareline | HashTracks" };
}
import { HarelineView } from "@/components/hareline/HarelineView";
import { PageHeader } from "@/components/layout/PageHeader";
import { FadeInSection } from "@/components/home/HeroAnimations";

export default async function HarelinePage() {
  const [events, user] = await Promise.all([
    prisma.event.findMany({
      where: { status: { not: "CANCELLED" }, isManualEntry: { not: true }, kennel: { isHidden: false } },
      include: {
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
        },
      },
      orderBy: { date: "asc" },
    }),
    getOrCreateUser(),
  ]);
  let subscribedKennelIds: string[] = [];
  const attendanceMap: Record<string, { id: string; participationLevel: string; status: string; stravaUrl: string | null; notes: string | null }> = {};
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

  // Fetch weather for upcoming events within 10-day window
  const weatherMap = await getWeatherForEvents(
    events.map((e) => ({
      id: e.id,
      date: e.date,
      latitude: e.latitude,
      longitude: e.longitude,
      kennel: { region: e.kennel.region },
    })),
  );

  // Serialize dates for client component
  const serializedEvents = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    dateUtc: e.dateUtc,
    timezone: e.timezone,
    kennelId: e.kennelId,
    kennel: e.kennel,
    runNumber: e.runNumber,
    title: e.title,
    haresText: e.haresText,
    startTime: e.startTime,
    locationName: e.locationName,
    locationStreet: e.locationStreet,
    locationCity: e.locationCity,
    locationAddress: e.locationAddress,
    description: e.description,
    sourceUrl: e.sourceUrl,
    status: e.status,
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
  }));

  return (
    <div>
      <FadeInSection>
        <PageHeader
          title="The Hareline"
          description="Discover upcoming and past hashing events."
        />
      </FadeInSection>

      <FadeInSection delay={100}>
      <Suspense>
        <HarelineView
          events={serializedEvents}
          subscribedKennelIds={subscribedKennelIds}
          isAuthenticated={!!user}
          attendanceMap={attendanceMap}
          weatherMap={weatherMap}
        />
      </Suspense>
      </FadeInSection>
    </div>
  );
}
