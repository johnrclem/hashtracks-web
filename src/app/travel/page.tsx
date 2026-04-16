import { Suspense } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { executeTravelSearch } from "@/lib/travel/search";
import { findExistingSavedSearch, MAX_RADIUS_KM } from "@/app/travel/actions";
import { TravelSearchForm } from "@/components/travel/TravelSearchForm";
import { TravelResults } from "@/components/travel/TravelResults";
import { TravelResultsSkeleton } from "@/components/travel/TravelResultsSkeleton";
import { TripSummary } from "@/components/travel/TripSummary";
import { EmptyStates } from "@/components/travel/EmptyStates";
import { TravelHero } from "@/components/travel/TravelHero";
import { PopularDestinations } from "@/components/travel/PopularDestinations";
import { TravelAutoSave } from "@/components/travel/TravelAutoSave";

interface TravelPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function getParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const val = params[key];
  return typeof val === "string" ? val : undefined;
}

export async function generateMetadata({
  searchParams,
}: TravelPageProps): Promise<Metadata> {
  const params = await searchParams;
  const destination = getParam(params, "q");

  if (destination) {
    return {
      title: `Hashes in ${destination} — HashTracks`,
      description: `Find confirmed trails and likely runs in ${destination} with HashTracks Travel Mode.`,
    };
  }

  return {
    title: "Travel Mode — HashTracks",
    description:
      "Find hashes on the road. Discover confirmed events, likely trails, and hashing opportunities at your travel destination.",
  };
}

export default async function TravelPage({ searchParams }: TravelPageProps) {
  const params = await searchParams;

  const lat = getParam(params, "lat");
  const lng = getParam(params, "lng");
  const from = getParam(params, "from");
  const to = getParam(params, "to");
  const q = getParam(params, "q");
  const r = getParam(params, "r");
  const tz = getParam(params, "tz");

  const hasSearchParams =
    lat != null && lng != null && from != null && to != null;

  // No search params → show landing state with hero + popular destinations
  if (!hasSearchParams) {
    return (
      <>
        <TravelHero />
        <PopularDestinations />
      </>
    );
  }

  // Has search params → execute search and show results
  const latitude = Number.parseFloat(lat);
  const longitude = Number.parseFloat(lng);
  // Clamp at the page boundary so a URL like ?r=99999 cannot turn the
  // primary kennel pass into an effectively-global scan (CodeRabbit).
  // Floor to a whole number — Prisma's Int column rejects fractions.
  const requestedRadius = r ? Number.parseInt(r, 10) : 50;
  const radiusKm = Math.max(1, Math.min(MAX_RADIUS_KM, requestedRadius || 50));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <EmptyStates variant="error" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      {/* Compact search form for editing */}
      <TravelSearchForm
        variant="compact"
        initialValues={{
          destination: q ?? "",
          latitude,
          longitude,
          startDate: from,
          endDate: to,
          radiusKm,
          timezone: tz,
        }}
      />

      {/* Search results with Suspense for streaming */}
      <Suspense fallback={<TravelResultsSkeleton />}>
        <TravelResultsServer
          latitude={latitude}
          longitude={longitude}
          radiusKm={radiusKm}
          startDate={from}
          endDate={to}
          destination={q ?? ""}
          timezone={tz}
          filterParams={params}
          pendingAutoSave={getParam(params, "saved") === "1"}
        />
      </Suspense>
    </div>
  );
}

/**
 * Async server component that fetches search results.
 * Wrapped in Suspense so the search form renders immediately while
 * this component streams in after the DB queries complete.
 */
async function TravelResultsServer({
  latitude,
  longitude,
  radiusKm,
  startDate,
  endDate,
  destination,
  timezone,
  filterParams,
  pendingAutoSave,
}: {
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;
  endDate: string;
  destination: string;
  timezone?: string;
  filterParams: Record<string, string | string[] | undefined>;
  pendingAutoSave: boolean;
}) {
  const { confidenceFilter, distanceFilter } = parseFilterParams(filterParams);

  try {
    const results = await executeTravelSearch(prisma, {
      latitude,
      longitude,
      radiusKm,
      startDate,
      endDate,
      timezone,
      filters: {
        confidence: confidenceFilter,
        distanceTier: distanceFilter,
      },
    });

    // Auth is optional — failures inside getOrCreateUser() (Clerk outages,
    // analytics side-effects, non-P2002 Prisma errors) must NOT blank the
    // page. Run once and reuse for both the isAuthenticated flag (Save
    // Trip button) and attendance-map enrichment ("Going" badge).
    const user = await safeGetUser();
    const isAuthenticated = user != null;

    // SSR check: has this user already saved a trip with these exact search
    // params? Coords-based match so label variation doesn't false-negative.
    // Runs only when authed; null for guests (the "unsaved" default).
    const initialSavedId = isAuthenticated
      ? await findExistingSavedSearch({
          latitude,
          longitude,
          radiusKm,
          startDate,
          endDate,
        })
      : null;

    const confirmedEventIds = [
      ...results.confirmed,
      ...(results.broaderResults?.confirmed ?? []),
    ].map((r) => r.eventId);

    const attendanceMap = await loadAttendanceMap(user, confirmedEventIds);

    // Serialize Date objects for client components
    const serializedResults = {
      ...results,
      confirmed: results.confirmed.map((r) => ({
        ...r,
        date: r.date.toISOString(),
        attendance: attendanceMap[r.eventId] ?? null,
      })),
      likely: results.likely.map((r) => ({
        ...r,
        date: r.date.toISOString(),
      })),
      possible: results.possible.map((r) => ({
        ...r,
        date: r.date?.toISOString() ?? null,
      })),
      broaderResults: results.broaderResults
        ? {
            confirmed: results.broaderResults.confirmed.map((r) => ({
              ...r,
              date: r.date.toISOString(),
              attendance: attendanceMap[r.eventId] ?? null,
            })),
            likely: results.broaderResults.likely.map((r) => ({
              ...r,
              date: r.date.toISOString(),
            })),
            possible: results.broaderResults.possible.map((r) => ({
              ...r,
              date: r.date?.toISOString() ?? null,
            })),
          }
        : undefined,
    };

    // Events exposed to TripSummary for Export Calendar .ics generation.
    // Use broaderResults when the primary radius came up empty — mirrors
    // the no_nearby render contract the results component already follows.
    const exportableConfirmed =
      results.emptyState === "no_nearby" && serializedResults.broaderResults
        ? serializedResults.broaderResults.confirmed
        : serializedResults.confirmed;

    const tripSummaryProps = {
      destination,
      startDate,
      endDate,
      latitude,
      longitude,
      radiusKm,
      timezone,
      isAuthenticated,
      initialSavedId,
      confirmedCount: exportableConfirmed.length,
      likelyCount: results.likely.length + (results.broaderResults?.likely.length ?? 0),
      possibleCount: results.possible.length + (results.broaderResults?.possible.length ?? 0),
      confirmedEvents: exportableConfirmed.map((r) => ({
        date: r.date,
        startTime: r.startTime,
        timezone: r.timezone,
        title: r.title,
        runNumber: r.runNumber,
        haresText: r.haresText,
        locationName: r.locationName,
        sourceUrl: r.sourceUrl,
        kennelName: r.kennelName,
      })),
    };

    // Auto-save only fires for authenticated users returning from the
    // Save-Trip sign-in redirect with saved=1. Guests reaching this path
    // somehow shouldn't trigger the server action (it'll fail auth anyway).
    const autoSave = pendingAutoSave && isAuthenticated;

    if (results.emptyState !== "none") {
      // Determine which results to show based on empty state type:
      // - no_confirmed: show likely/possible from the primary search (they exist)
      // - no_nearby: show broader results (primary radius was empty)
      // - no_coverage / error: show nothing
      const hasResultsToShow =
        results.emptyState === "no_confirmed" ||
        (results.emptyState === "no_nearby" && serializedResults.broaderResults);

      const resultsToRender = selectResultsToRender(results.emptyState, serializedResults);

      return (
        <>
          <TripSummary {...tripSummaryProps} />
          {autoSave && (
            <TravelAutoSave
              destination={destination}
              startDate={startDate}
              endDate={endDate}
              latitude={latitude}
              longitude={longitude}
              radiusKm={radiusKm}
              timezone={timezone}
            />
          )}
          <EmptyStates
            variant={results.emptyState}
            radiusKm={radiusKm}
            broaderRadiusKm={results.meta.broaderRadiusKm}
          />
          {hasResultsToShow && resultsToRender && (
            <TravelResults destination={destination} results={resultsToRender} />
          )}
        </>
      );
    }

    return (
      <>
        <TripSummary {...tripSummaryProps} />
        {autoSave && (
          <TravelAutoSave
            destination={destination}
            startDate={startDate}
            endDate={endDate}
            latitude={latitude}
            longitude={longitude}
            radiusKm={radiusKm}
            timezone={timezone}
          />
        )}
        <TravelResults destination={destination} results={serializedResults} />
      </>
    );
  } catch {
    return <EmptyStates variant="error" />;
  }
}

/**
 * Best-effort user fetch. Isolated in its own try/catch so Clerk outages,
 * user-sync side effects, or transient Prisma errors inside getOrCreateUser
 * don't blank the travel page. Returns null on any failure — the page then
 * renders the signed-out experience, which is a graceful degradation.
 */
async function safeGetUser(): Promise<Awaited<ReturnType<typeof getOrCreateUser>>> {
  try {
    return await getOrCreateUser();
  } catch (err) {
    console.error("[travel] getOrCreateUser failed; rendering as guest", err);
    return null;
  }
}

/**
 * Attendance map powering the "Going" badge. Accepts a pre-fetched user so
 * the page only calls getOrCreateUser once (shared with the isAuthenticated
 * check for the Save Trip button).
 */
async function loadAttendanceMap(
  user: Awaited<ReturnType<typeof getOrCreateUser>>,
  confirmedEventIds: string[],
): Promise<Record<string, { status: string; participationLevel: string }>> {
  if (!user || confirmedEventIds.length === 0) return {};
  try {
    const attendances = await prisma.attendance.findMany({
      where: { userId: user.id, eventId: { in: confirmedEventIds } },
      select: { eventId: true, status: true, participationLevel: true },
    });
    const map: Record<string, { status: string; participationLevel: string }> = {};
    for (const a of attendances) {
      map[a.eventId] = { status: a.status, participationLevel: a.participationLevel };
    }
    return map;
  } catch (err) {
    console.error("[travel] Failed to load attendance map; rendering without Going badges", err);
    return {};
  }
}

/**
 * Parse the URL filter params (`cf=high|medium`, `df=nearby|area`) into
 * the typed shape `executeTravelSearch` expects. Extracted from
 * TravelResultsServer to keep that function under SonarCloud's cognitive
 * complexity threshold of 15.
 */
function parseFilterParams(filterParams: Record<string, string | string[] | undefined>): {
  confidenceFilter: ("high" | "medium" | "low")[] | undefined;
  distanceFilter: ("nearby" | "area" | "drive")[] | undefined;
} {
  const cf = getParam(filterParams, "cf");
  const df = getParam(filterParams, "df");
  return {
    confidenceFilter: cf ? (cf.split("|") as ("high" | "medium" | "low")[]) : undefined,
    distanceFilter: df ? (df.split("|") as ("nearby" | "area" | "drive")[]) : undefined,
  };
}

/**
 * Pick which result set to render based on emptyState. Replaces a
 * three-level nested ternary in TravelResultsServer (SonarCloud "no
 * nested ternary"). Returns null when no result set is appropriate
 * (no_coverage / error path).
 */
function selectResultsToRender<T extends {
  broaderResults?: { confirmed: T["confirmed"]; likely: T["likely"]; possible: T["possible"] };
  confirmed: unknown;
  likely: unknown;
  possible: unknown;
}>(
  emptyState: string,
  serialized: T,
): T | null {
  if (emptyState === "no_confirmed") return serialized;
  if (emptyState === "no_nearby" && serialized.broaderResults) {
    return {
      ...serialized,
      confirmed: serialized.broaderResults.confirmed,
      likely: serialized.broaderResults.likely,
      possible: serialized.broaderResults.possible,
    };
  }
  return null;
}
