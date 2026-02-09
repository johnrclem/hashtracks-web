import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getOrCreateUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { SubscribeButton } from "@/components/kennels/SubscribeButton";
import { EventCard, type HarelineEvent } from "@/components/hareline/EventCard";

export default async function KennelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    include: {
      aliases: { select: { alias: true }, orderBy: { alias: "asc" } },
      _count: { select: { members: true } },
    },
  });

  if (!kennel) notFound();

  const [user, events] = await Promise.all([
    getOrCreateUser(),
    prisma.event.findMany({
      where: { kennelId: kennel.id },
      include: {
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true },
        },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  let isSubscribed = false;
  if (user) {
    const subscription = await prisma.userKennel.findUnique({
      where: { userId_kennelId: { userId: user.id, kennelId: kennel.id } },
    });
    isSubscribed = !!subscription;
  }

  // Split events into upcoming and past
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);

  const serialized: HarelineEvent[] = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    kennelId: e.kennelId,
    kennel: e.kennel,
    runNumber: e.runNumber,
    title: e.title,
    haresText: e.haresText,
    startTime: e.startTime,
    locationName: e.locationName,
    locationAddress: e.locationAddress,
    description: e.description,
    sourceUrl: e.sourceUrl,
    status: e.status,
  }));

  const upcoming = serialized.filter(
    (e) => new Date(e.date).getTime() >= todayUtc,
  );
  const past = serialized
    .filter((e) => new Date(e.date).getTime() < todayUtc)
    .reverse(); // most recent first

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{kennel.fullName}</h1>
        <p className="mt-1 text-lg text-muted-foreground">
          {kennel.shortName}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge>{kennel.region}</Badge>
          <Badge variant="outline">{kennel.country}</Badge>
          <span className="text-sm text-muted-foreground">
            {kennel._count.members}{" "}
            {kennel._count.members === 1 ? "subscriber" : "subscribers"}
          </span>
        </div>
      </div>

      <SubscribeButton
        kennelId={kennel.id}
        isSubscribed={isSubscribed}
        isAuthenticated={!!user}
      />

      {kennel.description && (
        <p className="text-muted-foreground">{kennel.description}</p>
      )}

      {kennel.website && (
        <a
          href={kennel.website}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-primary hover:underline"
        >
          {kennel.website}
        </a>
      )}

      {kennel.aliases.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground">
            Also known as
          </h2>
          <div className="mt-1 flex flex-wrap gap-1">
            {kennel.aliases.map((a) => (
              <Badge key={a.alias} variant="secondary">
                {a.alias}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Upcoming Events</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <div className="space-y-3">
            {upcoming.map((event) => (
              <EventCard key={event.id} event={event} density="medium" />
            ))}
          </div>
        )}
      </div>

      {/* Past Events */}
      {past.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Past Events</h2>
          <div className="space-y-3">
            {past.slice(0, 10).map((event) => (
              <EventCard key={event.id} event={event} density="medium" />
            ))}
            {past.length > 10 && (
              <p className="text-sm text-muted-foreground">
                And {past.length - 10} more past events.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
