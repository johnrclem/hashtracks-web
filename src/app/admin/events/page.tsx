import { prisma } from "@/lib/db";
import { EventTable } from "@/components/admin/EventTable";

interface PageProps {
  searchParams: Promise<{
    kennelId?: string;
    sourceId?: string;
    dateStart?: string;
    dateEnd?: string;
    sortBy?: string;
    sortDir?: string;
    page?: string;
    pageSize?: string;
  }>;
}

const VALID_PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

function buildOrderBy(sortBy?: string, sortDir?: string) {
  const dir: "asc" | "desc" = sortDir === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "kennelName":
      return { kennel: { shortName: dir } };
    case "title":
      return { title: dir };
    case "runNumber":
      return { runNumber: dir };
    case "attendanceCount":
      return { attendances: { _count: dir } };
    case "date":
    default:
      return { date: dir };
  }
}

export default async function AdminEventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { kennelId, sourceId, dateStart, dateEnd, sortBy, sortDir } = params;

  // Pagination
  const pageSize = VALID_PAGE_SIZES.includes(parseInt(params.pageSize ?? "", 10))
    ? parseInt(params.pageSize!, 10)
    : DEFAULT_PAGE_SIZE;
  const currentPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const skip = (currentPage - 1) * pageSize;

  const hasFilters = !!(kennelId || sourceId || dateStart || dateEnd);

  // Build where clause from filters
  const conditions: Record<string, unknown>[] = [];
  if (kennelId) conditions.push({ kennelId });
  if (sourceId === "none") {
    conditions.push({ rawEvents: { none: {} } });
  } else if (sourceId) {
    conditions.push({ rawEvents: { some: { sourceId } } });
  }
  if (dateStart) {
    conditions.push({ date: { gte: new Date(dateStart + "T00:00:00Z") } });
  }
  if (dateEnd) {
    conditions.push({ date: { lte: new Date(dateEnd + "T23:59:59Z") } });
  }

  const where = conditions.length > 0 ? { AND: conditions } : {};
  const orderBy = buildOrderBy(sortBy, sortDir);

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
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.kennel.findMany({
      orderBy: { shortName: "asc" },
      select: { id: true, shortName: true, fullName: true, region: true },
    }),
    prisma.source.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.event.count({ where }),
  ]);

  const totalPages = Math.ceil(totalCount / pageSize);

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

  const rangeStart = totalCount > 0 ? skip + 1 : 0;
  const rangeEnd = Math.min(skip + pageSize, totalCount);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          Events
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            {totalCount > 0
              ? `Showing ${rangeStart}–${rangeEnd} of ${totalCount}${hasFilters ? " matching" : ""}`
              : hasFilters
                ? "0 matching"
                : "0 total"}
          </span>
        </h2>
      </div>

      <EventTable
        events={serializedEvents}
        kennels={kennels}
        sources={sources}
        filters={{ kennelId, sourceId, dateStart, dateEnd, sortBy, sortDir }}
        hasFilters={hasFilters}
        totalCount={totalCount}
        currentPage={currentPage}
        pageSize={pageSize}
        totalPages={totalPages}
      />
    </div>
  );
}
