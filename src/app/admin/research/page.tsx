import { prisma } from "@/lib/db";
import { ResearchDashboard } from "@/components/admin/ResearchDashboard";

export const metadata = { title: "Source Research — HashTracks Admin" };
export const maxDuration = 300;

export default async function ResearchPage() {
  const [regions, proposals, coverageGaps] = await Promise.all([
    prisma.region.findMany({
      select: { id: true, name: true, abbrev: true, country: true },
      orderBy: { name: "asc" },
    }),
    prisma.sourceProposal.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: {
        region: { select: { name: true, abbrev: true } },
        kennel: { select: { id: true, shortName: true } },
      },
    }),
    // Kennels without any non-HASHREGO source, grouped by region
    prisma.kennel.findMany({
      where: {
        isHidden: false,
        sources: {
          none: { source: { type: { not: "HASHREGO" } } },
        },
      },
      select: {
        id: true,
        shortName: true,
        regionId: true,
        website: true,
      },
      orderBy: { shortName: "asc" },
    }),
  ]);

  // Count proposals by status
  const statusCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    error: 0,
    total: proposals.length,
  };
  for (const p of proposals) {
    if (p.status === "PENDING") statusCounts.pending++;
    else if (p.status === "APPROVED") statusCounts.approved++;
    else if (p.status === "REJECTED") statusCounts.rejected++;
    else if (p.status === "ERROR") statusCounts.error++;
  }

  // Build coverage gaps by region
  const gapsByRegion = new Map<string, { id: string; shortName: string; website: string | null }[]>();
  for (const k of coverageGaps) {
    const list = gapsByRegion.get(k.regionId) ?? [];
    list.push({ id: k.id, shortName: k.shortName, website: k.website });
    gapsByRegion.set(k.regionId, list);
  }

  const serializedProposals = proposals.map((p) => ({
    id: p.id,
    regionId: p.regionId,
    regionName: p.region.name,
    regionAbbrev: p.region.abbrev,
    kennelId: p.kennelId,
    kennelName: p.kennel?.shortName ?? p.kennelName ?? null,
    url: p.url,
    sourceName: p.sourceName,
    discoveryMethod: p.discoveryMethod,
    detectedType: p.detectedType,
    extractedConfig: p.extractedConfig,
    confidence: p.confidence,
    explanation: p.explanation,
    status: p.status,
    createdSourceId: p.createdSourceId,
    createdAt: p.createdAt.toISOString(),
  }));

  const serializedGaps = Object.fromEntries(
    Array.from(gapsByRegion.entries()).map(([regionId, kennels]) => [
      regionId,
      kennels,
    ]),
  );

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Source Research</h2>
      <ResearchDashboard
        regions={regions}
        proposals={serializedProposals}
        coverageGaps={serializedGaps}
        statusCounts={statusCounts}
      />
    </div>
  );
}
