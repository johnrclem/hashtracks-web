import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { listSavedSearches, type SavedSearchSummary } from "@/app/travel/actions";
import { executeTravelSearch } from "@/lib/travel/search";
import { SavedTripCard } from "@/components/travel/SavedTripCard";
import { SavedTripsEmpty } from "@/components/travel/SavedTripsEmpty";

export const metadata: Metadata = {
  title: "Saved trips — HashTracks Travel",
  description: "Your saved travel searches with live result counts.",
};

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface EnrichedSearch {
  search: SavedSearchSummary;
  status: "soon" | "active";
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

  // Run live searches in parallel. Each search is bounded (one trip window)
  // and `executeTravelSearch` already parallelizes its internal DB calls,
  // so 5 trips × ~800ms p95 collapses to ~800ms total via Promise.all.
  // Per-trip try/catch — one failed trip doesn't blank the dashboard.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const enriched: EnrichedSearch[] = await Promise.all(
    searches.map(async (search) => {
      const dest = search.destination;
      if (!dest) {
        // Defensive: a TravelSearch without any TravelDestination shouldn't
        // exist, but render the row inertly if it does.
        return { search, status: "active" as const, counts: null, isPast: false };
      }

      const isPast = dest.endDate.getTime() < today.getTime();
      const isSoon =
        !isPast &&
        dest.startDate.getTime() >= today.getTime() &&
        dest.startDate.getTime() <= today.getTime() + SEVEN_DAYS_MS;

      let counts: EnrichedSearch["counts"] = null;
      if (!isPast) {
        try {
          const out = await executeTravelSearch(prisma, {
            latitude: dest.latitude,
            longitude: dest.longitude,
            radiusKm: dest.radiusKm,
            startDate: dest.startDate.toISOString().slice(0, 10),
            endDate: dest.endDate.toISOString().slice(0, 10),
            timezone: dest.timezone ?? undefined,
          });
          counts = {
            confirmed: out.confirmed.length,
            likely: out.likely.length,
            possible: out.possible.length,
          };
        } catch (err) {
          console.error(`[saved trips] Search failed for ${search.id}`, err);
          // counts stays null → card renders without counts gracefully
        }
      }

      return {
        search,
        status: isSoon ? "soon" : "active",
        counts,
        isPast,
      };
    }),
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
          entry.search.destination ? (
            <SavedTripCard
              key={entry.search.id}
              id={entry.search.id}
              destination={entry.search.destination}
              status={entry.status}
              counts={entry.counts}
            />
          ) : null,
        )}
      </div>
    </section>
  );
}
