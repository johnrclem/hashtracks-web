import { prisma } from "@/lib/db";
import { SourceTable } from "@/components/admin/SourceTable";
import { SourceForm } from "@/components/admin/SourceForm";
import { RefreshAllButton } from "@/components/admin/RefreshAllButton";
import { Button } from "@/components/ui/button";

export default async function AdminSourcesPage() {
  const [sources, openAlerts] = await Promise.all([
    prisma.source.findMany({
      orderBy: { name: "asc" },
      include: {
        kennels: {
          include: {
            kennel: { select: { id: true, shortName: true, fullName: true } },
          },
        },
        _count: { select: { rawEvents: true } },
      },
    }),
    prisma.alert.findMany({
      where: { type: "UNMATCHED_TAGS", status: "OPEN" },
      select: { sourceId: true, context: true },
    }),
  ]);

  const allKennels = await prisma.kennel.findMany({
    orderBy: { shortName: "asc" },
    select: { id: true, shortName: true, fullName: true, region: true },
  });

  // Build a map of sourceId → unmatched tags from open alerts
  const alertTagsBySource = new Map<string, string[]>();
  for (const alert of openAlerts) {
    const ctx = alert.context as Record<string, unknown> | null;
    const tags = Array.isArray(ctx?.tags) ? (ctx.tags as string[]) : [];
    if (tags.length > 0) {
      if (!alertTagsBySource.has(alert.sourceId)) {
        alertTagsBySource.set(alert.sourceId, []);
      }
      alertTagsBySource.get(alert.sourceId)!.push(...tags);
    }
  }

  const serialized = sources.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    trustLevel: s.trustLevel,
    scrapeFreq: s.scrapeFreq,
    scrapeDays: s.scrapeDays,
    config: s.config,
    healthStatus: s.healthStatus,
    lastScrapeAt: s.lastScrapeAt?.toISOString() ?? null,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    linkedKennels: s.kennels.map((sk) => ({
      id: sk.kennel.id,
      shortName: sk.kennel.shortName,
      fullName: sk.kennel.fullName,
    })),
    rawEventCount: s._count.rawEvents,
    openAlertTags: alertTagsBySource.get(s.id) ?? [],
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Manage Sources</h2>
        <div className="flex items-center gap-2">
          <RefreshAllButton />
          <SourceForm
            allKennels={allKennels}
            trigger={<Button size="sm">Add Source</Button>}
          />
        </div>
      </div>

      <SourceTable sources={serialized} allKennels={allKennels} />
    </div>
  );
}
