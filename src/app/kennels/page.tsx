import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { KennelDirectory } from "@/components/kennels/KennelDirectory";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Kennels · HashTracks",
};

export default async function KennelsPage() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0));

  const [kennels, upcomingEvents] = await Promise.all([
    prisma.kennel.findMany({
      orderBy: [{ region: "asc" }, { fullName: "asc" }],
      select: {
        id: true,
        slug: true,
        shortName: true,
        fullName: true,
        region: true,
        country: true,
        description: true,
        foundedYear: true,
        scheduleDayOfWeek: true,
        scheduleTime: true,
        scheduleFrequency: true,
      },
    }),
    prisma.event.findMany({
      where: { date: { gte: todayUtc }, status: "CONFIRMED" },
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
      nextEvent: next ? { date: next.date.toISOString(), title: next.title } : null,
    };
  });

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kennel Directory</h1>
          <p className="mt-1 text-muted-foreground">
            Browse hashing kennels and subscribe to your home kennels.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/kennels/request">Request a Kennel</Link>
        </Button>
      </div>

      <Suspense>
        <KennelDirectory kennels={kennelsWithNext} />
      </Suspense>
    </div>
  );
}
