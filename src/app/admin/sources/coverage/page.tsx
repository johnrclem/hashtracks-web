import Link from "next/link";
import { prisma } from "@/lib/db";
import { CoverageTable } from "@/components/admin/CoverageTable";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Source Coverage — HashTracks Admin" };

export default async function CoveragePage() {
  const kennels = await prisma.kennel.findMany({
    orderBy: [{ region: "asc" }, { shortName: "asc" }],
    select: {
      id: true,
      shortName: true,
      fullName: true,
      region: true,
      sources: {
        select: {
          source: {
            select: {
              id: true,
              name: true,
              type: true,
              healthStatus: true,
              enabled: true,
            },
          },
        },
      },
      _count: { select: { events: true } },
    },
  });

  const serialized = kennels.map((k) => ({
    id: k.id,
    shortName: k.shortName,
    fullName: k.fullName,
    region: k.region,
    eventCount: k._count.events,
    sources: k.sources.map((sk) => ({
      id: sk.source.id,
      name: sk.source.name,
      type: sk.source.type,
      healthStatus: sk.source.healthStatus,
      enabled: sk.source.enabled,
    })),
  }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
            <Link href="/admin/sources">← Sources</Link>
          </Button>
          <h2 className="text-lg font-semibold">Source Coverage</h2>
        </div>
        <Button size="sm" asChild>
          <Link href="/admin/sources/new">Add Source</Link>
        </Button>
      </div>
      <CoverageTable kennels={serialized} />
    </div>
  );
}
