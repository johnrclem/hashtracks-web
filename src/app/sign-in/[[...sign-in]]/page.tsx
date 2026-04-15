import { SignIn } from "@clerk/nextjs";
import { MapPin } from "lucide-react";
import { formatDateCompact } from "@/lib/travel/format";

interface SignInPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const params = await searchParams;
  const raw = params.redirect_url;
  const redirectUrl = typeof raw === "string" ? raw : null;
  const travelContext = parseTravelRedirect(redirectUrl);

  return (
    <div className="flex min-h-[calc(100vh-10rem)] flex-col items-center justify-center gap-8 px-4">
      {travelContext ? (
        <TravelContextHeader {...travelContext} />
      ) : (
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Welcome back to HashTracks
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in to track your runs and view your stats.
          </p>
        </div>
      )}
      <SignIn />
    </div>
  );
}

export interface TravelContext {
  destination: string;
  startDate: string;
  endDate: string;
  isSave: boolean;
}

/**
 * Extract Travel-Mode context from a `redirect_url` like
 * `/travel?lat=…&q=Boston,+MA,+USA&from=2026-04-12&to=2026-04-20&saved=1`.
 * Returns null when the redirect doesn't target `/travel` or lacks the
 * required params — falls through to the generic heading.
 */
export function parseTravelRedirect(redirectUrl: string | null): TravelContext | null {
  if (!redirectUrl) return null;
  try {
    // Relative URL — use a dummy origin; only path + search matter.
    const url = new URL(redirectUrl, "https://hashtracks.local");
    if (!url.pathname.startsWith("/travel")) return null;
    const destination = url.searchParams.get("q");
    const startDate = url.searchParams.get("from");
    const endDate = url.searchParams.get("to");
    if (!destination || !startDate || !endDate) return null;
    return {
      destination,
      startDate,
      endDate,
      isSave: url.searchParams.get("saved") === "1",
    };
  } catch {
    return null;
  }
}

function TravelContextHeader({
  destination,
  startDate,
  endDate,
  isSave,
}: TravelContext) {
  const start = formatDateCompact(startDate, { withWeekday: true });
  const end = formatDateCompact(endDate, { withWeekday: true });
  return (
    <div className="max-w-md space-y-2 text-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
        <MapPin className="h-3 w-3" />
        {isSave ? "Saving a trip" : "Continuing to travel"}
      </div>
      <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
        {isSave ? "Save your trip to" : "Continue your trip to"}{" "}
        <span className="text-emerald-600 dark:text-emerald-400">{destination}</span>
      </h1>
      <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {start} → {end}
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Sign in to pick up right where you left off.
      </p>
    </div>
  );
}
