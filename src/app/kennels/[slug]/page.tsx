import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatSchedule, stripMarkdown } from "@/lib/format";
import { getOrCreateUser } from "@/lib/auth";
import { Users } from "lucide-react";
import { SubscribeButton } from "@/components/kennels/SubscribeButton";
import { MismanAccessButton } from "@/components/kennels/MismanAccessButton";
import type { HarelineEvent } from "@/components/hareline/EventCard";
import { MismanManagementSection } from "@/components/kennels/MismanManagementSection";
import { QuickInfoCard } from "@/components/kennels/QuickInfoCard";
import { KennelStats } from "@/components/kennels/KennelStats";
import { TrailLocationMap } from "@/components/kennels/TrailLocationMap";
import { EventTabs } from "@/components/kennels/EventTabs";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { getRegionColor } from "@/lib/region";
import { FadeInSection } from "@/components/home/HeroAnimations";
import { buildKennelJsonLd, safeJsonLd } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const kennel = await prisma.kennel.findUnique({
    where: { slug },
    select: {
      shortName: true,
      fullName: true,
      isHidden: true,
      description: true,
      foundedYear: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
    },
  });
  if (!kennel || kennel.isHidden) return { title: "Kennel · HashTracks" };
  const title = `${kennel.shortName} · Kennels · HashTracks`;

  const parts: string[] = [];
  if (kennel.fullName && kennel.fullName !== kennel.shortName) {
    parts.push(kennel.fullName);
  }
  const schedule = formatSchedule(kennel);
  if (schedule) parts.push(`Runs ${schedule}`);
  if (kennel.foundedYear) parts.push(`Founded ${kennel.foundedYear}`);
  if (kennel.description) parts.push(stripMarkdown(kennel.description));
  const raw = parts.join(". ") || `${kennel.shortName} on HashTracks`;
  const description = raw.length > 200
    ? raw.slice(0, raw.lastIndexOf(" ", 200)) + "..."
    : raw;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/kennels/${slug}` },
    openGraph: { title, description },
  };
}

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

  if (!kennel || kennel.isHidden) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  const kennelJsonLd = buildKennelJsonLd({
    fullName: kennel.fullName,
    shortName: kennel.shortName,
    slug: kennel.slug,
    region: kennel.region,
    foundedYear: kennel.foundedYear,
    description: kennel.description,
    website: kennel.website,
  }, baseUrl);

  const [user, events] = await Promise.all([
    getOrCreateUser(),
    prisma.event.findMany({
      where: { kennelId: kennel.id, status: { not: "CANCELLED" }, isManualEntry: { not: true }, parentEventId: null },
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
    locationStreet: e.locationStreet,
    locationCity: e.locationCity,
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
    .reverse();

  // Stats — use unique date count for resilience against duplicate canonical events
  const uniqueDates = new Set(events.map(e => e.date.toISOString().split("T")[0]));
  const totalEvents = uniqueDates.size;
  const currentRunNumber =
    upcoming.find((e) => e.runNumber != null)?.runNumber ??
    past.find((e) => e.runNumber != null)?.runNumber ??
    null;
  const oldestEventDate = events.length > 0 ? events[0].date.toISOString() : null;
  const nextRunDate = upcoming.length > 0 ? upcoming[0].date : null;

  // Trail locations for map (only events with precise coordinates)
  const trailLocations = events
    .filter((e) => e.latitude != null && e.longitude != null)
    .map((e) => ({
      lat: e.latitude!,
      lng: e.longitude!,
    }));

  // Region color for theming
  const regionColor = kennel.region ? getRegionColor(kennel.region) : "#6b7280";

  // Initials for logo fallback
  const initials = kennel.shortName
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();

  return (
    <div className="space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(kennelJsonLd) }}
      />
      {/* ── Breadcrumb ── */}
      <FadeInSection>
        <nav className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link href="/kennels" className="hover:text-foreground transition-colors">Kennels</Link>
          <span>/</span>
          <span className="text-foreground">{kennel.shortName}</span>
        </nav>
      </FadeInSection>

      {/* ── Hero ── */}
      <div
        className="-mx-4 -mt-4 px-4 pb-6 pt-8 sm:-mx-6 sm:px-6 sm:pt-10 rounded-b-2xl"
        style={{
          background: `linear-gradient(to bottom, ${regionColor}12, transparent)`,
        }}
      >
        <div className="flex items-start gap-4 sm:gap-5">
          {/* Logo or initials */}
          {kennel.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={kennel.logoUrl}
              alt={`${kennel.shortName} logo`}
              className="h-20 w-20 rounded-xl object-contain bg-white dark:bg-background ring-2 ring-white dark:ring-white/20 shadow-md sm:h-24 sm:w-24"
            />
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-xl text-xl font-bold text-white shadow-md ring-2 ring-white/80 dark:ring-white/20 sm:h-24 sm:w-24 sm:text-2xl"
              style={{ backgroundColor: regionColor }}
            >
              {initials}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {kennel.fullName}
            </h1>
            <p className="mt-0.5 text-base text-muted-foreground">
              {kennel.shortName}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {kennel.region && <RegionBadge region={kennel.region} />}
              {kennel.country && (
                <span className="inline-flex items-center rounded-full border border-border/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {kennel.country}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-full bg-foreground/[0.06] px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                <Users className="h-3 w-3" />
                {kennel._count.members}
              </span>
            </div>

            {/* Action buttons */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
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
          </div>
        </div>
      </div>

      {/* ── About Card (schedule, info, social, description) ── */}
      <FadeInSection delay={100}>
        <QuickInfoCard kennel={kennel} regionColor={regionColor} />
      </FadeInSection>

      {/* ── Stats Achievement Cards ── */}
      <FadeInSection delay={200}>
      <KennelStats
        currentRunNumber={currentRunNumber}
        totalEvents={totalEvents}
        oldestEventDate={oldestEventDate}
        nextRunDate={nextRunDate}
        lastEventDate={kennel.lastEventDate ? kennel.lastEventDate.toISOString() : null}
        foundedYear={kennel.foundedYear}
        region={kennel.region ?? undefined}
      />
      </FadeInSection>

      {/* ── Event Tabs (Upcoming / Past) ── */}
      <FadeInSection delay={300}>
        <EventTabs upcoming={upcoming} past={past} />
      </FadeInSection>

      {/* ── Trail Location Map ── */}
      {kennel.region && (
        <TrailLocationMap locations={trailLocations} region={kennel.region} />
      )}

      {/* ── Misman Management (role-gated) ── */}
      {(userRole === "MISMAN" || userRole === "ADMIN") && (
        <MismanManagementSection
          kennelId={kennel.id}
          kennelShortName={kennel.shortName}
        />
      )}
    </div>
  );
}
