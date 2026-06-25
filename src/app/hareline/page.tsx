import type { Metadata } from "next";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { getWeatherForEvents } from "@/lib/weather";
import { getOrCreateUser } from "@/lib/auth";
import { regionAbbrev } from "@/lib/region";
import { parseList } from "@/lib/format";
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
}: Readonly<{
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}>) {
  const params = await searchParams;
  const timeParam = typeof params.time === "string" ? params.time : null;
  const initialTimeMode: TimeMode = timeParam === "past" ? "past" : "upcoming";
  // #1560 PR F — read `?kennels` from the URL so the SSR fetch can scope
  // the payload to a specific kennel set. Without this, kennel filtering
  // stayed client-side and series children (excluded from the default
  // unfiltered payload) never reached the client — GGFM Friday
  // Strawberry Moon went missing from /hareline?kennels=<ggfm-id>.
  //
  // Delegates to `parseList` so SSR + client use identical parse rules.
  // HarelineView writes `?kennels=a|b` (pipe-separated); `parseList` also
  // accepts comma for legacy bookmarked URLs. Without sharing this helper
  // (Codex PR #1712 review), pipe-separated deep links parsed as `["a|b"]`
  // — a single bogus ID — and SSR returned an empty payload on refresh.
  const kennelsParam = params.kennels;
  let initialKennelIds: string[] = [];
  if (typeof kennelsParam === "string") {
    initialKennelIds = parseList(kennelsParam);
  } else if (Array.isArray(kennelsParam)) {
    initialKennelIds = kennelsParam.flatMap((v) => parseList(v));
  }

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
          <HarelineData
            initialTimeMode={initialTimeMode}
            initialKennelIds={initialKennelIds}
          />
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
async function HarelineData({
  initialTimeMode,
  initialKennelIds,
}: Readonly<{ initialTimeMode: TimeMode; initialKennelIds: string[] }>) {
  // Capture `now` before awaiting and thread it into `loadEventsForTimeMode`
  // so the server query boundary, the `serverNowMs` prop, and the client's
  // hydrated bucket split all derive from the same instant. Without a shared
  // clock, a request that straddles UTC midnight could have the DB query
  // select from one day while the client computes its buckets from the next.
  const now = new Date();
  const nowMs = now.getTime();

  // #1560 PR F — pass `initialKennelIds` through so the SSR query can scope
  // to a specific kennel set when `?kennels=<id>` is in the URL. Without
  // this, kennel filtering stayed client-side and series children whose
  // primary kennel matches the filter (excluded from the default unfiltered
  // payload because the global hareline still uses `parentEventId: null`)
  // never reached the client.
  const [{ events, hasMore: initialHasMore }, user] = await Promise.all([
    loadEventsForTimeMode(initialTimeMode, nowMs, initialKennelIds),
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
      initialKennelIds={initialKennelIds}
      initialHasMore={initialHasMore}
      serverNowMs={nowMs}
      subscribedKennelIds={subscribedKennelIds}
      isAuthenticated={!!user}
      attendanceMap={attendanceMap}
      weatherMap={weatherMap}
    />
  );
}
