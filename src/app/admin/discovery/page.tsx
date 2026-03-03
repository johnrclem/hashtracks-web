import { prisma } from "@/lib/db";
import { DiscoveryTable } from "@/components/admin/DiscoveryTable";

export const metadata = { title: "Kennel Discovery — HashTracks Admin" };

export default async function DiscoveryPage() {
  const [discoveries, regions, statusCounts] = await Promise.all([
    prisma.kennelDiscovery.findMany({
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        matchedKennel: {
          select: { id: true, shortName: true, slug: true },
        },
      },
    }),
    prisma.region.findMany({
      select: { id: true, name: true, country: true, abbrev: true },
      orderBy: { name: "asc" },
    }),
    prisma.kennelDiscovery.groupBy({
      by: ["status"],
      _count: true,
    }),
  ]);

  const counts = {
    total: discoveries.length,
    new: 0,
    matched: 0,
    addedLinked: 0,
    dismissed: 0,
  };
  for (const sc of statusCounts) {
    if (sc.status === "NEW") counts.new = sc._count;
    else if (sc.status === "MATCHED") counts.matched = sc._count;
    else if (sc.status === "ADDED" || sc.status === "LINKED") counts.addedLinked += sc._count;
    else if (sc.status === "DISMISSED") counts.dismissed = sc._count;
  }

  const serialized = discoveries.map((d) => ({
    id: d.id,
    externalSource: d.externalSource,
    externalSlug: d.externalSlug,
    name: d.name,
    location: d.location,
    latitude: d.latitude,
    longitude: d.longitude,
    schedule: d.schedule,
    externalUrl: d.externalUrl,
    website: d.website,
    contactEmail: d.contactEmail,
    yearStarted: d.yearStarted,
    trailPrice: d.trailPrice,
    memberCount: d.memberCount,
    status: d.status,
    matchedKennelId: d.matchedKennelId,
    matchScore: d.matchScore,
    matchCandidates: Array.isArray(d.matchCandidates) &&
      d.matchCandidates.every(
        (c: unknown) =>
          typeof c === "object" && c !== null &&
          "id" in c && "shortName" in c && "score" in c,
      )
      ? (d.matchCandidates as Array<{ id: string; shortName: string; score: number }>)
      : null,
    matchedKennel: d.matchedKennel,
    lastSeenAt: d.lastSeenAt.toISOString(),
    createdAt: d.createdAt.toISOString(),
  }));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Kennel Discovery</h2>
      <DiscoveryTable
        discoveries={serialized}
        regions={regions}
        counts={counts}
      />
    </div>
  );
}
