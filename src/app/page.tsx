import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { formatDateShort, formatTimeCompact } from "@/lib/format";

export default async function HomePage() {
  const { userId } = await auth();

  // Build a UTC noon date for today to compare upcoming events
  const now = new Date();
  const todayUtcNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

  const [upcomingCount, kennelCount, regionCount, nextEvents] = await Promise.all([
    prisma.event.count({
      where: { date: { gte: todayUtcNoon }, status: { not: "CANCELLED" } },
    }),
    prisma.kennel.count(),
    prisma.kennel.findMany({
      select: { region: true },
      distinct: ["region"],
    }).then((rows) => rows.length),
    prisma.event.findMany({
      where: { date: { gte: todayUtcNoon }, status: { not: "CANCELLED" } },
      include: { kennel: { select: { shortName: true, fullName: true, slug: true, region: true } } },
      orderBy: { date: "asc" },
      take: 3,
    }),
  ]);

  return (
    <div className="flex flex-col items-center justify-center gap-8 py-16 text-center">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        HashTracks
      </h1>
      <p className="max-w-lg text-lg text-muted-foreground">
        The Strava of Hashing. Discover upcoming runs, track your attendance,
        and view your personal stats &mdash; all in one place.
      </p>

      {/* Hero stats */}
      <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
        <span><span className="font-semibold text-foreground">{upcomingCount}</span> upcoming events</span>
        <span><span className="font-semibold text-foreground">{kennelCount}</span> kennels</span>
        <span><span className="font-semibold text-foreground">{regionCount}</span> regions</span>
      </div>

      {/* Next events preview */}
      {nextEvents.length > 0 && (
        <div className="w-full max-w-lg space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Coming Up
          </h2>
          {nextEvents.map((event) => (
            <Link
              key={event.id}
              href={`/hareline/${event.id}`}
              className="block rounded-lg border px-3 py-2 text-left shadow-sm transition-colors hover:border-foreground/20"
            >
              <div className="min-w-0 space-y-0.5">
                {/* Line 1: date · kennel · region · run# · time */}
                <div className="flex flex-nowrap items-center gap-1.5 overflow-hidden text-sm">
                  <span className="shrink-0 whitespace-nowrap font-medium">
                    {formatDateShort(event.date.toISOString())}
                  </span>
                  <span className="text-muted-foreground">&middot;</span>
                  <span className="shrink-0 font-medium text-primary" title={event.kennel.fullName}>
                    {event.kennel.shortName}
                  </span>
                  <RegionBadge region={event.kennel.region} size="sm" />
                  {event.runNumber && (
                    <>
                      <span className="text-muted-foreground">&middot;</span>
                      <span className="shrink-0 text-muted-foreground">#{event.runNumber}</span>
                    </>
                  )}
                  {event.startTime && (
                    <>
                      <span className="text-muted-foreground">&middot;</span>
                      <span className="shrink-0 text-muted-foreground">
                        {formatTimeCompact(event.startTime)}
                      </span>
                    </>
                  )}
                </div>

                {/* Line 2: title */}
                {event.title && (
                  <p className="truncate text-sm">{event.title}</p>
                )}

                {/* Line 3: hares */}
                {event.haresText && (
                  <p className="truncate text-sm text-muted-foreground">
                    Hares: {event.haresText}
                  </p>
                )}

                {/* Line 4: location */}
                {event.locationName && (
                  <p className="truncate text-sm text-muted-foreground">
                    {event.locationName}
                  </p>
                )}
              </div>
            </Link>
          ))}
          <Link
            href="/hareline"
            className="inline-block text-xs text-primary hover:underline"
          >
            View full hareline &rarr;
          </Link>
        </div>
      )}

      {userId ? (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/hareline">View Hareline</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/logbook">My Logbook</Link>
          </Button>
        </div>
      ) : (
        <div className="flex gap-4">
          <Button asChild>
            <Link href="/sign-up">Get Started</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/sign-in">Sign In</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
