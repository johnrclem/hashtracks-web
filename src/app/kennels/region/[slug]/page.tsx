import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { regionBySlug, getStateGroup } from "@/lib/region";
import { getActivityStatus } from "@/lib/activity-status";
import { getTodayUtcNoon } from "@/lib/date";
import { generateRegionIntro, buildRegionItemListJsonLd, safeJsonLd } from "@/lib/seo";
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
  const [kennels, metaUpcoming] = await Promise.all([
    prisma.kennel.findMany({
      where: { region: region.name, isHidden: false },
      select: { id: true, lastEventDate: true, scheduleDayOfWeek: true },
    }),
    prisma.event.findMany({
      where: {
        date: { gte: todayMeta },
        status: "CONFIRMED",
        kennel: { region: region.name, isHidden: false },
      },
      select: { kennelId: true },
      distinct: ["kennelId"],
    }),
  ]);
  const kennelsWithUpcoming = new Set(metaUpcoming.map((e) => e.kennelId));
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate, kennelsWithUpcoming.has(k.id)) === "active",
  ).length;
  const days = kennels.map((k) => k.scheduleDayOfWeek).filter(Boolean) as string[];
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
        lastEventDate: true,
      },
    }),
    prisma.event.findMany({
      where: {
        date: { gte: todayUtc },
        status: "CONFIRMED",
        kennel: { region: region.name, isHidden: false },
      },
      orderBy: { date: "asc" },
      select: { kennelId: true, date: true, title: true },
    }),
  ]);

  // Build next event map
  const nextEventMap = new Map<string, { date: Date; title: string | null }>();
  for (const event of upcomingEvents) {
    if (!nextEventMap.has(event.kennelId)) {
      nextEventMap.set(event.kennelId, { date: event.date, title: event.title });
    }
  }

  // Serialize for client
  const kennelsWithNext = kennels.map((k) => {
    const next = nextEventMap.get(k.id);
    return {
      ...k,
      stateGroup: getStateGroup(k.region),
      nextEvent: next ? { date: next.date.toISOString(), title: next.title } : null,
      lastEventDate: k.lastEventDate ? k.lastEventDate.toISOString() : null,
    };
  });

  // Compute intro
  const activeCount = kennels.filter(
    (k) => getActivityStatus(k.lastEventDate, nextEventMap.has(k.id)) === "active",
  ).length;
  const days = kennels.map((k) => k.scheduleDayOfWeek).filter(Boolean) as string[];
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
