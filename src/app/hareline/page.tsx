import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { getWeatherForEvents } from "@/lib/weather";
import { getOrCreateUser } from "@/lib/auth";
import { regionAbbrev } from "@/lib/region";
import { HarelineView } from "@/components/hareline/HarelineView";
import HarelineLoading from "./loading";
import { PageHeader } from "@/components/layout/PageHeader";
import { FadeInSection } from "@/components/home/HeroAnimations";
import { loadEventsForTimeMode, type TimeMode } from "./actions";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const regions = typeof params.regions === "string" ? params.regions.split("|") : [];
  if (regions.length === 1) {
    const abbrev = regionAbbrev(regions[0]);
    return {
      title: `${abbrev} Runs | HashTracks`,
      description: `Upcoming hash house harrier runs in the ${abbrev} area.`,
    };
  }
  return {
    title: "Hareline | HashTracks",
    description: "Browse upcoming hash house harrier runs across all regions on HashTracks.",
  };
}

export default async function HarelinePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const timeParam = typeof params.time === "string" ? params.time : null;
  const initialTimeMode: TimeMode = timeParam === "past" ? "past" : "upcoming";

  return (
    <div>
      <FadeInSection>
        <PageHeader
          title="The Hareline"
          description="Discover upcoming and past hashing events."
        />
      </FadeInSection>

      <FadeInSection delay={100}>
        <Suspense fallback={<HarelineLoading />}>
          <HarelineData initialTimeMode={initialTimeMode} />
        </Suspense>
      </FadeInSection>
    </div>
  );
}

/**
 * All data fetching for the Hareline happens inside this Suspense
 * boundary. The shell (header + skeleton) paints immediately; events +
 * user data + weather stream together via Promise.all.
 *
 * `initialTimeMode` lets us avoid the "direct link to past" flash: when
 * `?time=past` is in the URL, the server fetches past events up front
 * instead of shipping upcoming and relying on the client to swap.
 */
async function HarelineData({ initialTimeMode }: { initialTimeMode: TimeMode }) {
  // Capture `now` before awaiting and thread it into `loadEventsForTimeMode`
  // so the server query boundary, the `serverNowMs` prop, and the client's
  // hydrated bucket split all derive from the same instant. Without a shared
  // clock, a request that straddles UTC midnight could have the DB query
  // select from one day while the client computes its buckets from the next.
  const now = new Date();
  const nowMs = now.getTime();

  const [events, user] = await Promise.all([
    loadEventsForTimeMode(initialTimeMode, nowMs),
    getOrCreateUser(),
  ]);

  let subscribedKennelIds: string[] = [];
  const attendanceMap: Record<string, { id: string; participationLevel: string; status: string; stravaUrl: string | null; notes: string | null }> = {};
  if (user) {
    const [subscriptions, attendances] = await Promise.all([
      prisma.userKennel.findMany({
        where: { userId: user.id },
        select: { kennelId: true },
      }),
      prisma.attendance.findMany({
        where: { userId: user.id },
        select: { eventId: true, id: true, participationLevel: true, status: true, stravaUrl: true, notes: true },
      }),
    ]);
    subscribedKennelIds = subscriptions.map((s) => s.kennelId);
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

  // Fetch weather for upcoming events within 10-day window. (No-op for
  // past mode — getWeatherForEvents skips past dates internally.)
  const weatherMap = await getWeatherForEvents(
    events.map((e) => ({
      id: e.id,
      date: e.date,
      latitude: e.latitude,
      longitude: e.longitude,
      kennel: { region: e.kennel?.region ?? "" },
    })),
  );

  return (
    <HarelineView
      events={events}
      initialTimeMode={initialTimeMode}
      serverNowMs={nowMs}
      subscribedKennelIds={subscribedKennelIds}
      isAuthenticated={!!user}
      attendanceMap={attendanceMap}
      weatherMap={weatherMap}
    />
  );
}
