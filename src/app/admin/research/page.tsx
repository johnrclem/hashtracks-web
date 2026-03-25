import { prisma } from "@/lib/db";
import { RequestSource } from "@/generated/prisma/client";
import { ResearchDashboard } from "@/components/admin/ResearchDashboard";
import type { ConfidenceLevel } from "@/pipeline/source-research";

export const metadata = { title: "Source Research — HashTracks Admin" };
export const maxDuration = 300;

export default async function ResearchPage() {
  const [regions, proposals, coverageGaps, geminiDiscoveries, allKennels, kennelSuggestions] = await Promise.all([
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
    // Gemini-discovered kennels (NEW or MATCHED only)
    prisma.kennelDiscovery.findMany({
      where: {
        externalSource: "GEMINI",
        status: { in: ["NEW", "MATCHED"] },
      },
      include: {
        matchedKennel: { select: { shortName: true } },
        regionRef: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.kennel.findMany({
      where: { isHidden: false },
      select: { id: true, shortName: true, fullName: true },
      orderBy: { shortName: "asc" },
    }),
    // Public kennel suggestions
    prisma.kennelRequest.findMany({
      where: { source: RequestSource.PUBLIC },
      orderBy: { createdAt: "desc" },
      include: { linkedRegion: { select: { name: true, abbrev: true } } },
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

  const serializedProposals = proposals.map(({ region, kennel, createdAt, ...rest }) => ({
    ...rest,
    regionName: region.name,
    regionAbbrev: region.abbrev,
    kennelName: kennel?.shortName ?? rest.kennelName ?? null,
    confidence: rest.confidence as ConfidenceLevel | null,
    createdAt: createdAt.toISOString(),
  }));

  const serializedDiscoveries = geminiDiscoveries.map(({ matchedKennel, regionRef, matchCandidates: raw, ...rest }) => {
    // Parse matchCandidates JSON
    const matchCandidates: { id: string; shortName: string; score: number }[] = [];
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (typeof c === "object" && c !== null && "id" in c && "shortName" in c && "score" in c) {
          const r = c as Record<string, unknown>;
          matchCandidates.push({ id: String(r.id), shortName: String(r.shortName), score: Number(r.score) });
        }
      }
    }

    return {
      ...rest,
      matchedKennelName: matchedKennel?.shortName ?? null,
      matchCandidates,
      regionName: regionRef?.name ?? null,
    };
  });

  const serializedGaps = Object.fromEntries(
    Array.from(gapsByRegion.entries()).map(([regionId, kennels]) => [
      regionId,
      kennels,
    ]),
  );

  const serializedSuggestions = kennelSuggestions.map(({ linkedRegion, createdAt, resolvedAt, updatedAt, ...rest }) => ({
    ...rest,
    regionName: linkedRegion?.name ?? rest.region ?? null,
    regionAbbrev: linkedRegion?.abbrev ?? null,
    createdAt: createdAt.toISOString(),
    resolvedAt: resolvedAt?.toISOString() ?? null,
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Source Research</h2>
      <ResearchDashboard
        regions={regions}
        proposals={serializedProposals}
        discoveries={serializedDiscoveries}
        coverageGaps={serializedGaps}
        statusCounts={statusCounts}
        kennels={allKennels}
        suggestions={serializedSuggestions}
      />
    </div>
  );
}
