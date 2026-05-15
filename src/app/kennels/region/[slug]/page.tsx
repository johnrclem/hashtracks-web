import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { regionBySlug } from "@/lib/region";
import { buildNextEventMap, serializeKennelWithNext } from "@/lib/kennel-directory";
import { getActivityStatus } from "@/lib/activity-status";
import { getTodayUtcNoon } from "@/lib/date";
import { generateRegionIntro, buildRegionItemListJsonLd, safeJsonLd } from "@/lib/seo";
import { collectKennelWeekdays, SCHEDULE_RULES_SELECT } from "@/lib/schedule-season";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import { PageHeader } from "@/components/layout/PageHeader";
import { FadeInSection } from "@/components/home/HeroAnimations";

// ISR: revalidate region pages every hour for fast crawl responses
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const region = regionBySlug(slug);
  if (!region) return { title: "Region · HashTracks" };

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  // Count active kennels for description
  const todayMeta = new Date(getTodayUtcNoon());
  const kennels = await prisma.kennel.findMany({
    where: { region: region.name, isHidden: false },
    select: {
      id: true,
      lastEventDate: true,
      scheduleDayOfWeek: true,
      scheduleRules: {
        where: { isActive: true },
        select: { rrule: true },
      },
      // #1023 spec D8: directory counts include co-hosted events for both
      // kennels — go through the EventKennel join so a kennel that's only
      // a secondary co-host on upcoming events still reads as "active".
      // `isCanonical: true` matches the next-event-map query below + the
      // page intro's canonical-only event derivation so the metadata stat
      // and the rendered page agree.
      _count: {
        select: {
          eventKennels: {
            where: { event: { date: { gte: todayMeta }, status: "CONFIRMED", isCanonical: true } },
          },
        },
      },
    },
  });
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate, k._count.eventKennels > 0) === "active",
  ).length;
  // #1390: include both legacy flat `scheduleDayOfWeek` AND any scheduleRules
  // BYDAY days. A kennel migrated to scheduleRules-only must still contribute
  // to the region intro/metadata day list.
  const days = [...new Set(kennels.flatMap((k) => collectKennelWeekdays(k)))];
  const intro = generateRegionIntro(region.name, activeCount, days);

  const title = `Hash House Harriers in ${region.name} | HashTracks`;
  const canonicalUrl = `${baseUrl}/kennels/region/${slug}`;

  return {
    title,
    description: intro,
    alternates: {
      canonical: canonicalUrl,
    },
    openGraph: {
      title,
      description: intro,
      url: canonicalUrl,
    },
  };
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const region = regionBySlug(slug);
  if (!region) notFound();

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";

  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

  const [kennels, upcomingEvents] = await Promise.all([
    prisma.kennel.findMany({
      where: { region: region.name, isHidden: false },
      orderBy: [{ fullName: "asc" }],
      select: {
        id: true,
        slug: true,
        shortName: true,
        fullName: true,
        region: true,
        country: true,
        latitude: true,
        longitude: true,
        description: true,
        foundedYear: true,
        scheduleDayOfWeek: true,
        scheduleTime: true,
        scheduleFrequency: true,
        scheduleRules: SCHEDULE_RULES_SELECT,
        lastEventDate: true,
      },
    }),
    // #1023 spec D8: include co-hosted events. The nested `eventKennels`
    // selector pushes the visible-in-region filter into SQL so we only
    // return the kennel-link rows the directory actually attributes to.
    prisma.event.findMany({
      where: {
        date: { gte: todayUtc },
        status: "CONFIRMED",
        isCanonical: true,
        eventKennels: { some: { kennel: { region: region.name, isHidden: false } } },
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        title: true,
        eventKennels: {
          where: { kennel: { region: region.name, isHidden: false } },
          select: { kennelId: true },
        },
      },
    }),
  ]);

  // #1023 spec D8: attribute each event to every region-matching kennel
  // on it (primary + co-hosts). See `src/lib/kennel-directory.ts`.
  const nextEventMap = buildNextEventMap(upcomingEvents);
  const kennelsWithNext = kennels.map((k) => serializeKennelWithNext(k, nextEventMap));

  // Compute intro
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate, nextEventMap.has(k.id)) === "active",
  ).length;
  // #1390: same union semantics as the metadata-side `days` derivation above.
  const days = [...new Set(kennels.flatMap((k) => collectKennelWeekdays(k)))];
  const intro = generateRegionIntro(region.name, activeCount, days);

  // JSON-LD
  const jsonLd = buildRegionItemListJsonLd(
    region.name,
    kennels.map((k) => ({ slug: k.slug })),
    baseUrl,
  );

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }}
      />

      <FadeInSection>
        <PageHeader
          title={`Hashing in ${region.name}`}
          description={intro}
        />
      </FadeInSection>

      <FadeInSection delay={100}>
        <Suspense>
          <KennelDirectory kennels={kennelsWithNext} />
        </Suspense>
      </FadeInSection>
    </div>
  );
}
