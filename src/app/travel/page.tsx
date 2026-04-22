import { Suspense } from "react";
import type { Metadata } from "next";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { executeTravelSearch } from "@/lib/travel/search";
import { findExistingSavedSearch } from "@/app/travel/actions";
import { MAX_RADIUS_KM, snapRadiusToTier } from "@/lib/travel/limits";
import { TravelSearchForm } from "@/components/travel/TravelSearchForm";
import { TravelResults } from "@/components/travel/TravelResults";
import { TravelResultsSkeleton } from "@/components/travel/TravelResultsSkeleton";
import { TripSummary } from "@/components/travel/TripSummary";
import { EmptyStates } from "@/components/travel/EmptyStates";
import { TravelHero } from "@/components/travel/TravelHero";
import { PopularDestinations } from "@/components/travel/PopularDestinations";
import { TravelAutoSave } from "@/components/travel/TravelAutoSave";

type SearchParamsRecord = Record<string, string | string[] | undefined>;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface TravelPageProps {
  searchParams: Promise<SearchParamsRecord>;
}

function getParam(
  params: SearchParamsRecord,
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
  const requestedRadius = Math.max(
    1,
    Math.min(MAX_RADIUS_KM, Number.parseInt(r ?? "50", 10) || 50),
  );
  // Snap server-side so SSR and the post-mount client snap agree.
  const radiusKm = snapRadiusToTier(requestedRadius);

  // YYYY-MM-DD shape check + chronological order. Without this a crafted
  // ?from=foo URL falls through to parseUtcNoonDate and produces NaN-typed
  // Dates that downstream `executeTravelSearch` treats as "now" via the
  // 90-day horizon math — confusing UX and a noisy Sentry error.
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !ISO_DATE_RE.test(from) ||
    !ISO_DATE_RE.test(to) ||
    from > to
  ) {
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
          requestedRadiusKm={requestedRadius}
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
  requestedRadiusKm,
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
  requestedRadiusKm: number;
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
      destinations: [
        { latitude, longitude, radiusKm, startDate, endDate, timezone },
      ],
      filters: {
        confidence: confidenceFilter,
        distanceTier: distanceFilter,
      },
    });
    const stop = results.destinations[0];
    const broaderResults = stop?.broaderResults;

    // Auth is optional — failures inside getOrCreateUser() (Clerk outages,
    // analytics side-effects, non-P2002 Prisma errors) must NOT blank the
    // page. Run once and reuse for both the isAuthenticated flag (Save
    // Trip button) and attendance-map enrichment ("Going" badge).
    const user = await safeGetUser();
    const isAuthenticated = user != null;

    // SSR check: has this user already saved a trip with these exact search
    // params? Coords-based match so label variation doesn't false-negative.
    // Runs only when authed; null for guests (the "unsaved" default).
    // Match on both the snapped and the original URL radius so legacy
     // saved trips with non-tier radii (e.g. r=137 from an API path or a
     // pre-tier build) still match when the user navigates to their
     // original URL.
    const initialSavedId = isAuthenticated
      ? await findExistingSavedSearch({
          latitude,
          longitude,
          radiusKm: radiusKm === requestedRadiusKm
            ? radiusKm
            : [radiusKm, requestedRadiusKm],
          startDate,
          endDate,
        })
      : null;

    const isMultiStop = results.destinations.length > 1;

    // Multi-stop: every stop's broader pass rows need to reach the
    // attendance map + serialized arrays. Single-stop's broader is
    // already captured via `broaderResults` (== destinations[0].broaderResults).
    const allBroaderConfirmed = isMultiStop
      ? results.destinations.flatMap((d) => d.broaderResults?.confirmed ?? [])
      : (broaderResults?.confirmed ?? []);
    const allBroaderLikely = isMultiStop
      ? results.destinations.flatMap((d) => d.broaderResults?.likely ?? [])
      : (broaderResults?.likely ?? []);
    const allBroaderPossible = isMultiStop
      ? results.destinations.flatMap((d) => d.broaderResults?.possible ?? [])
      : (broaderResults?.possible ?? []);

    const confirmedEventIds = [
      ...results.confirmed,
      ...allBroaderConfirmed,
    ].map((r) => r.eventId);

    const attendanceMap = await loadAttendanceMap(user, confirmedEventIds);

    // Serialize Date objects for client components. Explicit field list
    // (rather than `...results`) so the multi-destination `destinations`
    // array's Date fields don't silently cross the RSC boundary unserialized.
    const serializedResults = {
      emptyState: results.emptyState,
      meta: results.meta,
      // Per-stop metadata. Dates toISOString so the RSC boundary
      // serializes cleanly.
      destinations: results.destinations.map((d) => ({
        index: d.index,
        label: d.label,
        startDate: d.startDate.toISOString(),
        endDate: d.endDate.toISOString(),
        radiusKm: d.radiusKm,
        broaderRadiusKm: d.broaderRadiusKm,
      })),
      // Multi-stop: merge every stop's broader rows into the top-level
      // flat arrays so the multi-destination renderer (which iterates
      // the flat set tagged by destinationIndex) sees both primary and
      // broader results across ALL stops. Single-stop keeps today's
      // behavior — broader rows flow through `broaderResults` below and
      // `selectResultsToRender` swaps them in on `no_nearby`.
      confirmed: [...results.confirmed, ...(isMultiStop ? allBroaderConfirmed : [])].map((r) => ({
        ...r,
        date: r.date.toISOString(),
        attendance: attendanceMap[r.eventId] ?? null,
      })),
      likely: [...results.likely, ...(isMultiStop ? allBroaderLikely : [])].map((r) => ({
        ...r,
        date: r.date.toISOString(),
      })),
      possible: [...results.possible, ...(isMultiStop ? allBroaderPossible : [])].map((r) => ({
        ...r,
        date: r.date?.toISOString() ?? null,
        lastConfirmedAt: r.lastConfirmedAt?.toISOString() ?? null,
      })),
      broaderResults: broaderResults
        ? {
            confirmed: broaderResults.confirmed.map((r) => ({
              ...r,
              date: r.date.toISOString(),
              attendance: attendanceMap[r.eventId] ?? null,
            })),
            likely: broaderResults.likely.map((r) => ({
              ...r,
              date: r.date.toISOString(),
            })),
            possible: broaderResults.possible.map((r) => ({
              ...r,
              date: r.date?.toISOString() ?? null,
              lastConfirmedAt: r.lastConfirmedAt?.toISOString() ?? null,
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
      requestedRadiusKm,
      // When the service expanded to a broader region, surface the
      // larger radius so the hero count + summary can stop lying about
      // which radius the trails are actually within.
      effectiveRadiusKm: stop?.broaderRadiusKm ?? stop?.radiusKm ?? radiusKm,
      noCoverage: results.emptyState === "no_coverage",
      horizonTier: results.meta.horizonTier,
      timezone,
      isAuthenticated,
      initialSavedId,
      confirmedCount: exportableConfirmed.length,
      likelyCount: results.likely.length + (broaderResults?.likely.length ?? 0),
      possibleCount: results.possible.length + (broaderResults?.possible.length ?? 0),
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

    const tripHeader = (
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
      </>
    );

    if (results.emptyState !== "none") {
      // Multi-stop: skip the broader-swap since top-level arrays already
      // contain merged primary + all-stops-broader (see serialization above).
      // Single-stop: swap broader arrays in place on `no_nearby`.
      const resultsToRender = isMultiStop
        ? serializedResults
        : selectResultsToRender(results.emptyState, serializedResults);

      return (
        <>
          {tripHeader}
          <EmptyStates
            variant={results.emptyState}
            broaderRadiusKm={stop?.broaderRadiusKm}
          />
          {resultsToRender && (
            <TravelResults
              destination={destination}
              results={resultsToRender}
              destinations={serializedResults.destinations}
            />
          )}
        </>
      );
    }

    return (
      <>
        {tripHeader}
        <TravelResults
          destination={destination}
          results={serializedResults}
          destinations={serializedResults.destinations}
        />
      </>
    );
  } catch (err) {
    console.error("[travel] TravelResultsServer threw", err);
    Sentry.captureException(err);
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
 * the typed shape `executeTravelSearch` expects. Validates each value
 * against an allow-set so a crafted `?cf=xyz` is silently dropped rather
 * than propagated downstream as a malformed enum.
 */
type ConfidenceLevel = "high" | "medium" | "low";
type DistanceBucket = "nearby" | "area" | "drive";

const ALLOWED_CONFIDENCE = new Set<ConfidenceLevel>(["high", "medium", "low"]);
const ALLOWED_DISTANCE = new Set<DistanceBucket>(["nearby", "area", "drive"]);

function parseFilterParams(filterParams: SearchParamsRecord): {
  confidenceFilter: ConfidenceLevel[] | undefined;
  distanceFilter: DistanceBucket[] | undefined;
} {
  const cf = getParam(filterParams, "cf");
  const df = getParam(filterParams, "df");
  const confidenceFilter = cf
    ? cf.split("|").filter((v): v is ConfidenceLevel =>
        ALLOWED_CONFIDENCE.has(v as ConfidenceLevel),
      )
    : undefined;
  const distanceFilter = df
    ? df.split("|").filter((v): v is DistanceBucket =>
        ALLOWED_DISTANCE.has(v as DistanceBucket),
      )
    : undefined;
  return {
    // An empty filtered array would suppress every result; treat as
    // "no filter" instead so a malformed query falls back gracefully.
    confidenceFilter: confidenceFilter && confidenceFilter.length > 0 ? confidenceFilter : undefined,
    distanceFilter: distanceFilter && distanceFilter.length > 0 ? distanceFilter : undefined,
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
