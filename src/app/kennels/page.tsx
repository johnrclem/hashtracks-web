import type { Metadata } from "next";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import Link from "next/link";
import { getStateGroup, regionAbbrev, regionNameToSlug } from "@/lib/region";
import { buildRegionItemListJsonLd, safeJsonLd } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { FadeInSection } from "@/components/home/HeroAnimations";
import { SuggestKennelDialog } from "@/components/suggest/SuggestKennelDialog";

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}): Promise<Metadata> {
  const params = await searchParams;
  const regions = typeof params.regions === "string" ? params.regions.split("|") : [];
  if (regions.length === 1) {
    const abbrev = regionAbbrev(regions[0]);
    return {
      title: `${abbrev} Kennels | HashTracks`,
      description: `Hash house harrier kennels in the ${abbrev} area.`,
    };
  }
  return {
    title: "Kennel Directory | HashTracks",
    description: "Browse hash house harrier kennels across all regions on HashTracks. Find runs near you.",
  };
}

export default async function KennelsPage() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

  const [kennels, upcomingEvents] = await Promise.all([
    prisma.kennel.findMany({
      where: { isHidden: false },
      orderBy: [{ region: "asc" }, { fullName: "asc" }],
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
    // #1023 spec D8: include co-hosted events. The nested `eventKennels`
    // selector pushes the not-hidden filter into SQL so we only return the
    // kennel-link rows the directory actually attributes to.
    prisma.event.findMany({
      where: {
        date: { gte: todayUtc },
        status: "CONFIRMED",
        isCanonical: true,
        eventKennels: { some: { kennel: { isHidden: false } } },
      },
      orderBy: { date: "asc" },
      select: {
        date: true,
        title: true,
        eventKennels: {
          where: { kennel: { isHidden: false } },
          select: { kennelId: true },
        },
      },
    }),
  ]);

  // Build Map<kennelId, firstEvent> — events are sorted by date, so first
  // per kennel is next. Attribute each event to every kennel on it so a
  // co-host kennel's card shows the upcoming joint trail too.
  const nextEventMap = new Map<string, { date: Date; title: string | null }>();
  for (const event of upcomingEvents) {
    for (const ek of event.eventKennels) {
      if (!nextEventMap.has(ek.kennelId)) {
        nextEventMap.set(ek.kennelId, { date: event.date, title: event.title });
      }
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

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://hashtracks.xyz";
  // Cap at 100 items — schema.org recommends bounded ItemLists for large catalogs
  const directoryJsonLd = buildRegionItemListJsonLd(
    "All Regions",
    kennels.slice(0, 100).map((k) => ({ slug: k.slug })),
    baseUrl,
  );

  // Only include regions that resolve to a valid landing page slug
  const uniqueRegions = Array.from(new Set(kennels.map((k) => k.region)))
    .filter((r) => regionNameToSlug(r) !== null)
    .sort();

  return (
    <div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(directoryJsonLd) }}
      />

      <FadeInSection>
        <PageHeader
          title="Kennel Directory"
          description="Browse hashing kennels and subscribe to your home kennels."
          actions={
            <div className="flex items-center gap-2">
              <SuggestKennelDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Plus className="mr-1 h-3.5 w-3.5" /> Suggest a Kennel
                  </Button>
                }
              />
            </div>
          }
        />
      </FadeInSection>

      <FadeInSection delay={100}>
        <Suspense>
          <KennelDirectory kennels={kennelsWithNext} />
        </Suspense>
      </FadeInSection>

      {/* SEO: Crawlable links to region pages */}
      <FadeInSection delay={200}>
        <div className="mt-8 border-t pt-6">
          <h2 className="text-sm font-semibold text-muted-foreground mb-3">Browse by Region</h2>
          <div className="flex flex-wrap gap-2">
            {uniqueRegions.map((region) => {
              const slug = regionNameToSlug(region);
              if (!slug) return null;
              return (
                <Link
                  key={region}
                  href={`/kennels/region/${slug}`}
                  className="rounded-md border px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
                >
                  {region}
                </Link>
              );
            })}
          </div>
        </div>
      </FadeInSection>
    </div>
  );
}
