import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { toSlug } from "@/lib/kennel-utils";
import { formatSchedule, stripMarkdown } from "@/lib/format";
import { SCHEDULE_RULES_SELECT } from "@/lib/schedule-season";
import { getOrCreateUser } from "@/lib/auth";
import { Users } from "lucide-react";
import { SubscribeButton } from "@/components/kennels/SubscribeButton";
import { MismanAccessButton } from "@/components/kennels/MismanAccessButton";
import type { HarelineEvent } from "@/components/hareline/EventCard";
import { MismanManagementSection } from "@/components/kennels/MismanManagementSection";
import { QuickInfoCard } from "@/components/kennels/QuickInfoCard";
import { KennelStats } from "@/components/kennels/KennelStats";
import { KennelLogo } from "@/components/kennels/KennelLogo";
import { TrailLocationMapClient } from "@/components/kennels/TrailLocationMapClient";
import { EventTabs } from "@/components/kennels/EventTabs";
import { RegionBadge } from "@/components/hareline/RegionBadge";
import { getRegionColor, regionNameToSlug } from "@/lib/region";
import { FadeInSection } from "@/components/home/HeroAnimations";
import { buildKennelJsonLd, buildBreadcrumbJsonLd, safeJsonLd } from "@/lib/seo";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import { ShareButton } from "@/components/shared/ShareButton";

/**
 * When an incoming slug doesn't resolve directly, normalize it the same way
 * `toSlug` builds slugs from short names and look the kennel up under that
 * canonical form. Catches legacy/malformed slugs — most importantly ones with a
 * comma or other char outside `[a-z0-9-]` that the route can't otherwise match
 * (#2308 `sl,ut-discovery` → `sl-ut-discovery`). Returns the canonical slug to
 * redirect to, or null when no normalization helps. `toSlug` is idempotent on a
 * clean slug, so this is a no-op for the common path.
 */
async function resolveCanonicalKennelSlug(slug: string): Promise<string | null> {
  const normalized = toSlug(slug);
  if (!normalized || normalized === slug) return null;
  const match = await prisma.kennel.findUnique({
    where: { slug: normalized },
    select: { slug: true, isHidden: true },
  });
  return match && !match.isHidden ? match.slug : null;
}

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
      scheduleRules: SCHEDULE_RULES_SELECT,
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

  const baseUrl = getCanonicalSiteUrl();
  return {
    title,
    description,
    alternates: { canonical: `${baseUrl}/kennels/${slug}` },
    openGraph: { title, description, url: `${baseUrl}/kennels/${slug}` },
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
      scheduleRules: SCHEDULE_RULES_SELECT,
    },
  });

  if (!kennel) {
    // Legacy / malformed slug (e.g. a comma-containing slug, #2308) — redirect
    // to the canonical normalized slug if one resolves, else 404.
    const canonical = await resolveCanonicalKennelSlug(slug);
    if (canonical) redirect(`/kennels/${canonical}`);
    notFound();
  }
  if (kennel.isHidden) notFound();

  const baseUrl = getCanonicalSiteUrl();
  const kennelJsonLd = buildKennelJsonLd({
    fullName: kennel.fullName,
    shortName: kennel.shortName,
    slug: kennel.slug,
    region: kennel.region,
    foundedYear: kennel.foundedYear,
    description: kennel.description,
    website: kennel.website,
  }, baseUrl);

  const regionSlug = regionNameToSlug(kennel.region);
  const breadcrumbJsonLd = buildBreadcrumbJsonLd([
    { name: "Kennels", url: `${baseUrl}/kennels` },
    ...(regionSlug
      ? [{ name: kennel.region, url: `${baseUrl}/kennels/region/${regionSlug}` }]
      : []),
    { name: kennel.shortName, url: `${baseUrl}/kennels/${kennel.slug}` },
  ]);

  const [user, events, parentKennel] = await Promise.all([
    getOrCreateUser(),
    prisma.event.findMany({
      // #1023 step 5: filter via EventKennel join so co-host events
      // (where this kennel is a secondary, not the primary) appear here too.
      // #1560 PR F: NO `parentEventId: null` filter — series children whose
      // primary kennel is this kennel (e.g. GGFM Friday Strawberry Moon as
      // a child of NYCH3's 5-Boro umbrella) must appear on this kennel's
      // page. The `eventKennels.some` join correctly fans out to children
      // because each child gets its own primary `EventKennel` row per
      // #1023 step 2. The umbrella itself only appears on its host kennel's
      // page (its `kennelId` is the host's), so dropping the filter doesn't
      // pollute other kennel pages with parents they don't host.
      where: { eventKennels: { some: { kennelId: kennel.id } }, status: { not: "CANCELLED" }, isManualEntry: { not: true }, isCanonical: true },
      include: {
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
        },
        // Populate co-host kennels (#1023 step 5) — surfaces the
        // "Cherry City × OH3" conjunction in EventCard for multi-kennel
        // events. Empty array for the common single-kennel case.
        eventKennels: {
          where: { isPrimary: false },
          select: {
            kennel: { select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true } },
          },
          orderBy: { kennel: { shortName: "asc" } },
        },
        // #1560 — per-trail children for series parents. Slim select to
        // match the HarelineSeriesChild shape consumed by EventCard.
        childEvents: {
          where: {
            status: { not: "CANCELLED" },
            isManualEntry: { not: true },
            isCanonical: true,
            kennel: { isHidden: false },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            date: true,
            dateUtc: true,
            timezone: true,
            title: true,
            haresText: true,
            startTime: true,
            status: true,
            locationName: true,
            runNumber: true,
          },
        },
      },
      orderBy: { date: "asc" },
    }),
    // Skip hidden parents — linking would 404. Card falls back to raw text.
    kennel.parentKennelCode
      ? prisma.kennel.findFirst({
          where: { kennelCode: kennel.parentKennelCode, isHidden: false },
          select: { slug: true, shortName: true },
        })
      : Promise.resolve(null),
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

  // #1560 PR F — when both a series parent AND its children belong to this
  // kennel (e.g. NYCH3 hosts the 5-Boro umbrella AND its Saturday + Sunday
  // children), drop the children from the top-level list. They still surface
  // in the parent's expanded "Weekend at a glance" timeline. Without this
  // dedup, the Sat/Sun trails would render twice on the same page (Gemini
  // PR #1712 review). The GGFM case (child whose parent is NOT in this
  // kennel's events) is unaffected — the child stays as a flat row because
  // its `parentEventId` isn't in `parentIdsInResult`.
  const idsInResult = new Set(events.map((e) => e.id));
  const visibleEvents = events.filter(
    (e) => !e.parentEventId || !idsInResult.has(e.parentEventId),
  );

  const serialized: HarelineEvent[] = visibleEvents.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    dateUtc: e.dateUtc,
    timezone: e.timezone,
    kennelId: e.kennelId,
    kennel: e.kennel,
    // #1023 step 5: surface co-host kennels for the EventCard conjunction
    // ("Cherry City × OH3"). `eventKennels` was filtered to isPrimary=false
    // in the SELECT above, so this is just the secondaries.
    coHosts: e.eventKennels.map((ek) => ek.kennel),
    runNumber: e.runNumber,
    title: e.title,
    eventLabel: e.eventLabel,
    haresText: e.haresText,
    startTime: e.startTime,
    endTime: e.endTime,
    locationName: e.locationName,
    locationStreet: e.locationStreet,
    locationCity: e.locationCity,
    locationAddress: e.locationAddress,
    description: e.description,
    sourceUrl: e.sourceUrl,
    status: e.status,
    trailLengthText: e.trailLengthText,
    trailLengthMinMiles: e.trailLengthMinMiles,
    trailLengthMaxMiles: e.trailLengthMaxMiles,
    difficulty: e.difficulty,
    trailType: e.trailType,
    dogFriendly: e.dogFriendly,
    prelube: e.prelube,
    cost: e.cost,
    isSeriesParent: e.isSeriesParent,
    parentEventId: e.parentEventId,
    endDate: e.endDate ? e.endDate.toISOString() : null,
    childEvents: e.childEvents.map((c) => ({
      id: c.id,
      date: c.date.toISOString(),
      dateUtc: c.dateUtc,
      timezone: c.timezone,
      title: c.title,
      haresText: c.haresText,
      startTime: c.startTime,
      status: c.status,
      locationName: c.locationName,
      runNumber: c.runNumber,
    })),
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
  // "Latest Run" = highest run number among the most recent COMPLETED runs
  // (date < today). Past-only on purpose (#2385): kennels like T3H3 pre-populate
  // weekly placeholders far into the future (e.g. "#500 - Hare TBD" in 2027), so
  // including `upcoming` made Math.max report a run that hasn't happened. Taking
  // the max over a recent-past window still preserves the #2184 intent — a
  // low-numbered side-series ("Sloppy Trail #46") can't override the main
  // sequence ("Trail 802") just by being the most recent date. CANCELLED events
  // are already excluded by the events query above.
  const RECENT_PAST_FOR_RUN = 12;
  const recentRunNumbers = past.slice(0, RECENT_PAST_FOR_RUN)
    .map((e) => e.runNumber)
    .filter((n): n is number => n != null);
  const currentRunNumber = recentRunNumbers.length ? Math.max(...recentRunNumbers) : null;
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

  // Initials for logo fallback. Unicode-aware (\p{L}\p{N} + u flag) so accented
  // / non-Latin kennel names (München, Montréal) keep correct initials instead
  // of being stripped to ASCII. Mirrored in KennelCard's directory-card avatar.
  const initials = kennel.shortName
    .replace(/[^\p{L}\p{N}]/gu, "")
    .slice(0, 3)
    .toUpperCase();

  return (
    <div className="space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(kennelJsonLd) }}
      />
      {/* safeJsonLd() escapes </script>; input is a server-built schema object, not user HTML */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: /* nosemgrep: react-dangerouslysetinnerhtml */ safeJsonLd(breadcrumbJsonLd) }}
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
          {/* Logo (next/image, #1301) or initials fallback (#1300) */}
          <KennelLogo
            logoUrl={kennel.logoUrl}
            alt={`${kennel.shortName} logo`}
            width={96}
            height={96}
            loading="eager"
            className="h-20 w-20 rounded-xl object-contain bg-white dark:bg-background ring-2 ring-white dark:ring-white/20 shadow-md sm:h-24 sm:w-24"
            fallback={
              <div
                className="flex h-20 w-20 items-center justify-center rounded-xl text-xl font-bold text-white shadow-md ring-2 ring-white/80 dark:ring-white/20 sm:h-24 sm:w-24 sm:text-2xl"
                style={{ backgroundColor: regionColor }}
              >
                {initials}
              </div>
            }
          />

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
              <ShareButton
                url={`${baseUrl}/kennels/${kennel.slug}`}
                title={`${kennel.shortName} · HashTracks`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── About Card (schedule, info, social, description) ── */}
      <FadeInSection delay={100}>
        <QuickInfoCard kennel={kennel} parentKennel={parentKennel} regionColor={regionColor} />
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
        <TrailLocationMapClient locations={trailLocations} region={kennel.region} />
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
