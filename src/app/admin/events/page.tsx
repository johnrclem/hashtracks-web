import { prisma } from "@/lib/db";
import { EventTable } from "@/components/admin/EventTable";

interface PageProps {
  searchParams: Promise<{
    kennelId?: string;
    sourceId?: string;
    dateStart?: string;
    dateEnd?: string;
  }>;
}

export default async function AdminEventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { kennelId, sourceId, dateStart, dateEnd } = params;

  const hasFilters = !!(kennelId || sourceId || dateStart || dateEnd);

  // Build where clause from filters
  const conditions: Record<string, unknown>[] = [];
  if (kennelId) conditions.push({ kennelId });
  if (sourceId) {
    conditions.push({ rawEvents: { some: { sourceId } } });
  }
  if (dateStart) {
    conditions.push({ date: { gte: new Date(dateStart + "T00:00:00Z") } });
  }
  if (dateEnd) {
    conditions.push({ date: { lte: new Date(dateEnd + "T23:59:59Z") } });
  }

  const where = conditions.length > 0 ? { AND: conditions } : {};

  const [events, kennels, sources, totalCount] = await Promise.all([
    prisma.event.findMany({
      where,
      include: {
        kennel: { select: { shortName: true, region: true } },
        rawEvents: {
          select: {
            id: true,
            sourceId: true,
            source: { select: { name: true } },
          },
        },
        _count: { select: { attendances: true, hares: true } },
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
    prisma.kennel.findMany({
      orderBy: { shortName: "asc" },
      select: { id: true, shortName: true },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.event.count({ where }),
  ]);

  // Serialize dates for client component
  const serializedEvents = events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    kennelId: e.kennelId,
    kennelName: e.kennel.shortName,
    kennelRegion: e.kennel.region,
    title: e.title,
    runNumber: e.runNumber,
    startTime: e.startTime,
    status: e.status,
    sources: [...new Set(e.rawEvents.map((r) => r.source.name))],
    rawEventCount: e.rawEvents.length,
    attendanceCount: e._count.attendances,
    hareCount: e._count.hares,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Events
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {totalCount} {hasFilters ? "matching" : "total"}
          </span>
        </h2>
      </div>

      <EventTable
        events={serializedEvents}
        kennels={kennels}
        sources={sources}
        filters={{ kennelId, sourceId, dateStart, dateEnd }}
        hasFilters={hasFilters}
        totalCount={totalCount}
      />
    </div>
  );
}
