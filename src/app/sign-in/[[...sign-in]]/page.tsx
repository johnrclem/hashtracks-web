import { SignIn } from "@clerk/nextjs";
import { BadgeCheck, MapPin } from "lucide-react";
import { formatDateCompact } from "@/lib/travel/format";
import { parseTravelRedirect, type TravelContext } from "@/lib/travel/url";

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
        <TravelContextHeader ctx={travelContext} />
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

/**
 * Renders one of three contextual banners based on the redirect intent.
 * Pulled into a single component so the destination-bearing and
 * destination-less variants share card styling without divergence.
 */
function TravelContextHeader({ ctx }: { ctx: TravelContext }) {
  if (ctx.kind === "saved-trips") {
    return (
      <div className="max-w-md space-y-2 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
          <BadgeCheck className="h-3 w-3" />
          Your saved trips
        </div>
        <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
          Sign in to see your{" "}
          <span className="text-emerald-600 dark:text-emerald-400">saved trips</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          They&apos;ll be right where you left them.
        </p>
      </div>
    );
  }

  const start = formatDateCompact(ctx.startDate, { withWeekday: true });
  const end = formatDateCompact(ctx.endDate, { withWeekday: true });
  return (
    <div className="max-w-md space-y-2 text-center">
      <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
        <MapPin className="h-3 w-3" />
        {ctx.kind === "save" ? "Saving a trip" : "Continuing to travel"}
      </div>
      <h1 className="font-display text-2xl font-medium tracking-tight sm:text-3xl">
        {ctx.kind === "save" ? "Save your trip to" : "Continue your trip to"}{" "}
        <span className="text-emerald-600 dark:text-emerald-400">{ctx.destination}</span>
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
