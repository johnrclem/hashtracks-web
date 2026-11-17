import Link from "next/link";
import { prisma } from "@/lib/db";
import { DiscoveryTable } from "@/components/admin/DiscoveryTable";
import { HalfMindDiscoveryTable } from "@/components/admin/HalfMindDiscoveryTable";
import { HALF_MIND_EXTERNAL_SOURCE } from "@/lib/half-mind";

export const metadata = { title: "Kennel Discovery — HashTracks Admin" };
export const maxDuration = 300;

export default async function DiscoveryPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ source?: string }> }>) {
  const { source } = await searchParams;
  if (source === "halfmind") return <HalfMindView />;

  // The default view is every row except Half-Mind's, which have their own screen.
  const notHalfMind = { externalSource: { not: HALF_MIND_EXTERNAL_SOURCE } };
  const [discoveries, regions, statusCounts] = await Promise.all([
    prisma.kennelDiscovery.findMany({
      where: notHalfMind,
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
      where: notHalfMind,
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
      <SourceSwitch active="default" />
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <DiscoveryTable
          discoveries={serialized}
          regions={regions}
          counts={counts}
        />
      </div>
    </div>
  );
}

function SourceSwitch({ active }: Readonly<{ active: "default" | "halfmind" }>) {
  const link = "rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide";
  const on = "bg-muted text-foreground";
  const off = "text-muted-foreground hover:text-foreground";
  return (
    <div className="mb-4 flex items-center gap-2">
      <Link href="/admin/discovery" className={`${link} ${active === "default" ? on : off}`}>
        Kennel Discovery
      </Link>
      <Link href="/admin/discovery?source=halfmind" className={`${link} ${active === "halfmind" ? on : off}`}>
        Half-Mind
      </Link>
    </div>
  );
}

async function HalfMindView() {
  const [rows, regions, kennels] = await Promise.all([
    prisma.kennelDiscovery.findMany({
      where: { externalSource: HALF_MIND_EXTERNAL_SOURCE },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: { matchedKennel: { select: { id: true, shortName: true, slug: true } } },
    }),
    prisma.region.findMany({
      select: { id: true, name: true, country: true, abbrev: true, centroidLat: true, centroidLng: true },
      orderBy: { name: "asc" },
    }),
    prisma.kennel.findMany({
      where: { isHidden: false },
      select: { id: true, shortName: true, fullName: true, region: true },
      orderBy: { shortName: "asc" },
    }),
  ]);

  const serialized = rows.map((d) => ({
    id: d.id,
    externalSlug: d.externalSlug,
    name: d.name,
    location: d.location,
    latitude: d.latitude,
    longitude: d.longitude,
    schedule: d.schedule,
    externalUrl: d.externalUrl,
    externalStatus: d.externalStatus,
    externalCheckedAt: d.externalCheckedAt?.toISOString() ?? null,
    website: d.website,
    facebookUrl: d.facebookUrl,
    status: d.status,
    matchCandidates: parseCandidates(d.matchCandidates),
    matchedKennel: d.matchedKennel,
  }));

  return (
    <div>
      <SourceSwitch active="halfmind" />
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden p-4">
        <HalfMindDiscoveryTable rows={serialized} regions={regions} kennels={kennels} />
      </div>
    </div>
  );
}

function parseCandidates(json: unknown): Array<{ id: string; shortName: string; score: number }> | null {
  if (!Array.isArray(json)) return null;
  const out: Array<{ id: string; shortName: string; score: number }> = [];
  for (const c of json) {
    if (typeof c !== "object" || c === null) continue;
    const { id, shortName, score } = c as Record<string, unknown>;
    if (typeof id === "string" && typeof shortName === "string" && typeof score === "number") out.push({ id, shortName, score });
  }
  return out;
}
