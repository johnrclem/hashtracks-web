import { prisma } from "@/lib/db";
import { EventTable } from "@/components/admin/EventTable";
import { BackfillCitiesButton } from "@/components/admin/BackfillCitiesButton";

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
  // #1023 step 5: include co-hosted events when filtering by kennel,
  // OR-fallback to the legacy `Event.kennelId` denorm for safety.
  if (kennelId) {
    conditions.push({
      OR: [
        { eventKennels: { some: { kennelId } } },
        { kennelId },
      ],
    });
  }
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

  const [events, kennels, sources, totalCount, missingCityCount] = await Promise.all([
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
    prisma.event.count({
      where: { latitude: { not: null }, longitude: { not: null }, locationCity: null },
    }),
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
    adminCancelledAt: e.adminCancelledAt?.toISOString() ?? null,
    adminCancelledBy: e.adminCancelledBy,
    adminCancellationReason: e.adminCancellationReason,
    adminAuditLogCount: Array.isArray(e.adminAuditLog) ? e.adminAuditLog.length : 0,
    sources: [...new Set(e.rawEvents.map((r) => r.source.name))],
    rawEventCount: e.rawEvents.length,
    attendanceCount: e._count.attendances,
    hareCount: e._count.hares,
  }));

  const rangeStart = totalCount > 0 ? skip + 1 : 0;
  const rangeEnd = Math.min(skip + pageSize, totalCount);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Events</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {totalCount > 0
              ? `Showing ${rangeStart}–${rangeEnd} of ${totalCount}${hasFilters ? " matching" : ""}`
              : hasFilters
                ? "0 matching"
                : "0 total"}
          </p>
        </div>
        <BackfillCitiesButton missingCount={missingCityCount} />
      </div>

      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
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
    </div>
  );
}
