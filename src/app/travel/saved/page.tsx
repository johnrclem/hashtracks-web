import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { listSavedSearches, type SavedSearchSummary } from "@/app/travel/actions";
import { executeTravelSearch } from "@/lib/travel/search";
import { withConcurrency } from "@/lib/travel/url";
import { daysBetweenIsoDates } from "@/lib/travel/format";
import { todayInTimezone } from "@/lib/timezone";
import {
  SavedTripCard,
  type SavedTripStatus,
} from "@/components/travel/SavedTripCard";
import { SavedTripsEmpty } from "@/components/travel/SavedTripsEmpty";

export const metadata: Metadata = {
  title: "Saved trips — HashTracks Travel",
  description: "Your saved travel searches with live result counts.",
};

/**
 * Cap on parallel saved-trip searches. Each `executeTravelSearch` can fan
 * out to 15 weather API calls; running many in parallel risks quota. With
 * a typical user holding <5 saved trips this barely affects latency, and
 * power users with 20+ trips degrade gracefully.
 */
const MAX_PARALLEL_TRIP_SEARCHES = 3;

interface EnrichedSearch {
  search: SavedSearchSummary;
  status: SavedTripStatus;
  counts: { confirmed: number; likely: number; possible: number } | null;
  isPast: boolean;
}

export default async function SavedTripsPage() {
  // /travel(.*) is in the public matcher (proxy.ts). Auth-gate this nested
  // route in-page so we can preserve the redirect target.
  const user = await getOrCreateUser();
  if (!user) {
    redirect("/sign-in?redirect_url=/travel/saved");
  }

  const result = await listSavedSearches();
  if ("error" in result) {
    // listSavedSearches only errors on missing auth, which we just handled —
    // so this is genuinely unexpected. Surface a minimal error rather than
    // crashing the route.
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="font-display text-xl">Couldn&apos;t load your saved trips.</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing in a moment.
        </p>
      </div>
    );
  }

  const { searches } = result;

  if (searches.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12">
        <Header />
        <SavedTripsEmpty />
      </div>
    );
  }

  // Run live searches with bounded concurrency (see MAX_PARALLEL_TRIP_SEARCHES
  // above). Per-trip try/catch ensures one failed search doesn't blank the
  // dashboard; the affected card renders without counts gracefully.
  const enriched: EnrichedSearch[] = await withConcurrency(
    searches,
    MAX_PARALLEL_TRIP_SEARCHES,
    async (search) => {
      const legs = search.destinations;
      if (legs.length === 0) {
        // Defensive: a TravelSearch without any TravelDestination shouldn't
        // exist, but render the row inertly if it does.
        return { search, status: "active", counts: null, isPast: false };
      }
      // Past/soon is decided against the whole trip window, but each
      // boundary is evaluated in its own leg's timezone so a cross-
      // timezone itinerary doesn't misclassify near local midnight
      // (e.g. a Hawaii first leg + NYC last leg sharing a UTC-based
      // "today" would mark the trip past ~5 hours before NYC midnight).
      const firstLeg = legs[0];
      const lastLeg = legs[legs.length - 1];
      const todayAtStart = todayInTimezone(firstLeg.timezone);
      const todayAtEnd = todayInTimezone(lastLeg.timezone);
      const tripStartStr = firstLeg.startDate.toISOString().slice(0, 10);
      const tripEndStr = lastLeg.endDate.toISOString().slice(0, 10);

      const isPast = tripEndStr < todayAtEnd;
      const dayDelta = daysBetweenIsoDates(todayAtStart, tripStartStr);
      const isSoon = !isPast && dayDelta >= 0 && dayDelta <= 7;

      let counts: EnrichedSearch["counts"] = null;
      if (!isPast) {
        try {
          const out = await executeTravelSearch(prisma, {
            // Fan out across every leg so the count badges reflect the
            // whole itinerary, not just leg 01. PR 3a change.
            destinations: legs.map((leg) => ({
              latitude: leg.latitude,
              longitude: leg.longitude,
              radiusKm: leg.radiusKm,
              startDate: leg.startDate.toISOString().slice(0, 10),
              endDate: leg.endDate.toISOString().slice(0, 10),
              timezone: leg.timezone ?? undefined,
            })),
            // Dashboard only reads .length from the returned arrays for the
            // summary badges; fetching weather N× per saved trip is
            // unbounded dashboard-time cost that never renders.
            skipWeather: true,
          });
          // Honor the search service's empty-state contract: when a leg's
          // primary radius came up empty, real results live in its
          // broaderResults. Sum primary + per-leg broader for the
          // aggregate dashboard count badges.
          let confirmed = out.confirmed.length;
          let likely = out.likely.length;
          let possible = out.possible.length;
          for (const d of out.destinations) {
            if (d.broaderResults) {
              confirmed += d.broaderResults.confirmed.length;
              likely += d.broaderResults.likely.length;
              possible += d.broaderResults.possible.length;
            }
          }
          counts = { confirmed, likely, possible };
        } catch (err) {
          console.error(`[saved trips] Search failed for ${search.id}`, err);
        }
      }

      return { search, status: isSoon ? "soon" : "active", counts, isPast };
    },
  );

  const upcoming = enriched.filter((e) => !e.isPast);
  const past = enriched.filter((e) => e.isPast);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12">
      <Header count={searches.length} />

      {upcoming.length > 0 && (
        <Section title="Upcoming" entries={upcoming} />
      )}

      {past.length > 0 && (
        <Section title="Past" entries={past} muted />
      )}
    </div>
  );
}

function Header({ count }: { count?: number }) {
  return (
    <div className="mb-10 flex items-end justify-between gap-4">
      <div>
        <Link
          href="/travel"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          Plan another trip
        </Link>
        <h1 className="font-display text-3xl font-medium tracking-tight sm:text-4xl">
          Your saved trips
        </h1>
      </div>
      {count != null && count > 0 && (
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {count} saved
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  entries,
  muted = false,
}: {
  title: string;
  entries: EnrichedSearch[];
  muted?: boolean;
}) {
  return (
    <section className={`mb-10 ${muted ? "opacity-70" : ""}`}>
      <h2 className="mb-4 border-b border-border pb-2 font-display text-lg font-medium">
        {title}
        <span className="ml-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {entries.length}
        </span>
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map((entry) =>
          entry.search.destinations.length > 0 ? (
            <SavedTripCard
              key={entry.search.id}
              id={entry.search.id}
              createdAt={entry.search.createdAt}
              destinations={entry.search.destinations}
              status={entry.status}
              counts={entry.counts}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}
