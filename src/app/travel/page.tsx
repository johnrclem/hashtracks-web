import { Suspense } from "react";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { executeTravelSearch } from "@/lib/travel/search";
import { TravelSearchForm } from "@/components/travel/TravelSearchForm";
import { TravelResults } from "@/components/travel/TravelResults";
import { TravelResultsSkeleton } from "@/components/travel/TravelResultsSkeleton";
import { TripSummary } from "@/components/travel/TripSummary";
import { EmptyStates } from "@/components/travel/EmptyStates";
import { TravelHero } from "@/components/travel/TravelHero";
import { PopularDestinations } from "@/components/travel/PopularDestinations";

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
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);
  const radiusKm = r ? parseInt(r, 10) : 50;

  if (!isFinite(latitude) || !isFinite(longitude)) {
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
}: {
  latitude: number;
  longitude: number;
  radiusKm: number;
  startDate: string;
  endDate: string;
  destination: string;
  timezone?: string;
  filterParams: Record<string, string | string[] | undefined>;
}) {
  const cf = getParam(filterParams, "cf");
  const df = getParam(filterParams, "df");

  const confidenceFilter = cf
    ? (cf.split("|") as ("high" | "medium" | "low")[])
    : undefined;
  const distanceFilter = df
    ? (df.split("|") as ("nearby" | "area" | "drive")[])
    : undefined;

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

    // Serialize Date objects for client components
    const serializedResults = {
      ...results,
      confirmed: results.confirmed.map((r) => ({
        ...r,
        date: r.date.toISOString(),
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

    if (results.emptyState !== "none") {
      // Determine which results to show based on empty state type:
      // - no_confirmed: show likely/possible from the primary search (they exist)
      // - no_nearby: show broader results (primary radius was empty)
      // - no_coverage / error: show nothing
      const hasResultsToShow =
        results.emptyState === "no_confirmed" ||
        (results.emptyState === "no_nearby" && serializedResults.broaderResults);

      const resultsToRender =
        results.emptyState === "no_confirmed"
          ? serializedResults
          : results.emptyState === "no_nearby" && serializedResults.broaderResults
            ? {
                ...serializedResults,
                confirmed: serializedResults.broaderResults.confirmed,
                likely: serializedResults.broaderResults.likely,
                possible: serializedResults.broaderResults.possible,
              }
            : null;

      return (
        <>
          <TripSummary
            destination={destination}
            startDate={startDate}
            endDate={endDate}
            timezone={timezone}
            confirmedCount={results.confirmed.length}
            likelyCount={results.likely.length}
            possibleCount={results.possible.length}
          />
          <EmptyStates
            variant={results.emptyState}
            radiusKm={radiusKm}
            broaderRadiusKm={results.meta.broaderRadiusKm}
          />
          {hasResultsToShow && resultsToRender && (
            <TravelResults results={resultsToRender} />
          )}
        </>
      );
    }

    return (
      <>
        <TripSummary
          destination={destination}
          startDate={startDate}
          endDate={endDate}
          timezone={timezone}
          confirmedCount={results.confirmed.length}
          likelyCount={results.likely.length}
          possibleCount={results.possible.length}
        />
        <TravelResults results={serializedResults} />
      </>
    );
  } catch {
    return <EmptyStates variant="error" />;
  }
}
