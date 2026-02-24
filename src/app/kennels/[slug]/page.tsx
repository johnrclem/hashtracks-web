import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: { shortName: true },
  });
  if (!kennel) return { title: "Kennel · HashTracks" };
  return { title: `${kennel.shortName} · Kennels · HashTracks` };
}
import { getOrCreateUser } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { SubscribeButton } from "@/components/kennels/SubscribeButton";
import { MismanAccessButton } from "@/components/kennels/MismanAccessButton";
import type { HarelineEvent } from "@/components/hareline/EventCard";
import { CollapsibleEventList } from "@/components/kennels/CollapsibleEventList";
import { MismanManagementSection } from "@/components/kennels/MismanManagementSection";
import { QuickInfoCard } from "@/components/kennels/QuickInfoCard";
import { SocialLinks } from "@/components/kennels/SocialLinks";
import { KennelStats } from "@/components/kennels/KennelStats";

export default async function KennelDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    include: {
      _count: { select: { members: true } },
    },
  });

  if (!kennel) notFound();

  const [user, events] = await Promise.all([
    getOrCreateUser(),
    prisma.event.findMany({
      where: { kennelId: kennel.id, status: { not: "CANCELLED" } },
      include: {
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
        },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  let isSubscribed = false;
  let userRole: string | null = null;
  let hasPendingMismanRequest = false;
  if (user) {
    const subscription = await prisma.userKennel.findUnique({
      where: { userId_kennelId: { userId: user.id, kennelId: kennel.id } },
    });
    isSubscribed = !!subscription;
    userRole = subscription?.role ?? null;

    // Check for pending misman request
    const pendingRequest = await prisma.mismanRequest.findFirst({
      where: { userId: user.id, kennelId: kennel.id, status: "PENDING" },
    });
    hasPendingMismanRequest = !!pendingRequest;
  }

  // Split events into upcoming and past
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);

  const serialized: HarelineEvent[] = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    dateUtc: e.dateUtc,
    timezone: e.timezone,
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

  // Compute stats from events (already sorted asc by date)
  const totalEvents = events.length;
  const oldestEventDate = events.length > 0 ? events[0].date.toISOString() : null;
  const nextRunDate = upcoming.length > 0 ? upcoming[0].date : null;

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="flex items-start gap-4">
        {kennel.logoUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={kennel.logoUrl}
            alt={`${kennel.shortName} logo`}
            className="h-16 w-16 rounded-lg object-contain"
          />
        )}
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
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        <SubscribeButton
          kennelId={kennel.id}
          isSubscribed={isSubscribed}
          isAuthenticated={!!user}
        />
        <MismanAccessButton
          kennelId={kennel.id}
          kennelShortName={kennel.shortName}
          kennelSlug={kennel.slug}
          userRole={userRole}
          hasPendingRequest={hasPendingMismanRequest}
          isAuthenticated={!!user}
        />
      </div>

      {/* Quick Info Card */}
      <QuickInfoCard kennel={kennel} />

      {/* Social Links */}
      <SocialLinks kennel={kennel} />

      {/* Description */}
      {kennel.description && (
        <p className="text-muted-foreground">{kennel.description}</p>
      )}

      {/* Misman Management — visible only to mismans/admins */}
      {(userRole === "MISMAN" || userRole === "ADMIN") && (
        <MismanManagementSection
          kennelId={kennel.id}
          kennelShortName={kennel.shortName}
        />
      )}

      {/* Upcoming Events */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Upcoming Events</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming events.</p>
        ) : (
          <CollapsibleEventList events={upcoming} defaultLimit={4} label="upcoming" />
        )}
      </div>

      {/* Past Events */}
      {past.length > 0 && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Past Events</h2>
          <CollapsibleEventList events={past} defaultLimit={10} label="past" />
        </div>
      )}

      {/* Kennel Stats */}
      <KennelStats
        totalEvents={totalEvents}
        oldestEventDate={oldestEventDate}
        nextRunDate={nextRunDate}
      />
    </div>
  );
}
