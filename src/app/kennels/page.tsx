import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import { getStateGroup, regionAbbrev } from "@/lib/region";
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
  const regions = typeof params.regions === "string" ? params.regions.split(",") : [];
  if (regions.length === 1) {
    return { title: `${regionAbbrev(regions[0])} Kennels | HashTracks` };
  }
  return { title: "Kennels | HashTracks" };
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
      },
    }),
    prisma.event.findMany({
      where: { date: { gte: todayUtc }, status: "CONFIRMED", kennel: { isHidden: false } },
      orderBy: { date: "asc" },
      select: { kennelId: true, date: true, title: true },
    }),
  ]);

  // Build Map<kennelId, firstEvent> — events are sorted by date, so first per kennel is next
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
    };
  });

  return (
    <div>
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
    </div>
  );
}
