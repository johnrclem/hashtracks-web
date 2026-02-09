import { prisma } from "@/lib/db";
import { SourceTable } from "@/components/admin/SourceTable";
import { SourceForm } from "@/components/admin/SourceForm";
import { Button } from "@/components/ui/button";

export default async function AdminSourcesPage() {
  const sources = await prisma.source.findMany({
    orderBy: { name: "asc" },
    include: {
      kennels: {
        include: {
          kennel: { select: { id: true, shortName: true, fullName: true } },
        },
      },
      _count: { select: { rawEvents: true } },
    },
  });

  const allKennels = await prisma.kennel.findMany({
    orderBy: { shortName: "asc" },
    select: { id: true, shortName: true },
  });

  const serialized = sources.map((s) => ({
    id: s.id,
    name: s.name,
    url: s.url,
    type: s.type,
    trustLevel: s.trustLevel,
    scrapeFreq: s.scrapeFreq,
    healthStatus: s.healthStatus,
    lastScrapeAt: s.lastScrapeAt?.toISOString() ?? null,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    linkedKennels: s.kennels.map((sk) => ({
      id: sk.kennel.id,
      shortName: sk.kennel.shortName,
      fullName: sk.kennel.fullName,
    })),
    rawEventCount: s._count.rawEvents,
  }));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Manage Sources</h2>
        <SourceForm
          allKennels={allKennels}
          trigger={<Button size="sm">Add Source</Button>}
        />
      </div>

      <SourceTable sources={serialized} allKennels={allKennels} />
    </div>
  );
}
