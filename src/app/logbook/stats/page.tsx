import { redirect } from "next/navigation";
import Link from "next/link";
import { getOrCreateUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LogbookStats } from "@/components/logbook/LogbookStats";

const MILESTONES = [
  { target: 25, label: "" },
  { target: 50, label: "" },
  { target: 69, label: "Nice." },
  { target: 100, label: "Century" },
  { target: 150, label: "" },
  { target: 200, label: "" },
  { target: 250, label: "" },
  { target: 300, label: "" },
  { target: 400, label: "" },
  { target: 500, label: "Half Grand" },
  { target: 666, label: "Devilish" },
  { target: 700, label: "" },
  { target: 800, label: "" },
  { target: 900, label: "" },
  { target: 1000, label: "Grand" },
];

export default async function StatsPage() {
  const user = await getOrCreateUser();
  if (!user) redirect("/sign-in");

  const attendances = await prisma.attendance.findMany({
    where: { userId: user.id },
    include: {
      event: {
        include: {
          kennel: {
            select: { id: true, shortName: true, fullName: true, slug: true, region: true },
          },
        },
      },
    },
    orderBy: { event: { date: "asc" } },
  });

  const totalRuns = attendances.length;
  const totalHares = attendances.filter((a) => a.participationLevel === "HARE").length;

  // By kennel
  const kennelMap = new Map<string, { kennelId: string; shortName: string; fullName: string; slug: string; region: string; count: number }>();
  for (const a of attendances) {
    const k = a.event.kennel;
    const existing = kennelMap.get(k.id);
    if (existing) {
      existing.count++;
    } else {
      kennelMap.set(k.id, { kennelId: k.id, shortName: k.shortName, fullName: k.fullName, slug: k.slug, region: k.region, count: 1 });
    }
  }
  const byKennel = Array.from(kennelMap.values()).sort((a, b) => b.count - a.count);

  // By region
  const regionMap = new Map<string, number>();
  for (const a of attendances) {
    const r = a.event.kennel.region;
    regionMap.set(r, (regionMap.get(r) ?? 0) + 1);
  }
  const byRegion = Array.from(regionMap.entries())
    .map(([region, count]) => ({ region, count }))
    .sort((a, b) => b.count - a.count);

  // By level
  const levelMap = new Map<string, number>();
  for (const a of attendances) {
    const l = a.participationLevel as string;
    levelMap.set(l, (levelMap.get(l) ?? 0) + 1);
  }
  const byLevel = Array.from(levelMap.entries())
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.count - a.count);

  // Milestones — attendances are ordered by date ascending
  const milestones = MILESTONES.map((m) => {
    if (totalRuns >= m.target) {
      const milestoneAttendance = attendances[m.target - 1];
      return {
        ...m,
        reached: true,
        eventTitle: milestoneAttendance.event.title,
        eventDate: milestoneAttendance.event.date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        }),
        kennelShortName: milestoneAttendance.event.kennel.shortName,
      };
    }
    return { ...m, reached: false };
  });

  return (
    <div>
      <nav className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/logbook" className="hover:text-foreground">
          Logbook
        </Link>
        <span>/</span>
        <span className="text-foreground">Stats</span>
      </nav>

      <div className="mt-4">
        <h1 className="text-2xl font-bold">My Stats</h1>
        <p className="mt-1 text-muted-foreground">
          Your hashing career at a glance.
        </p>
      </div>

      <div className="mt-6">
        <LogbookStats
          totalRuns={totalRuns}
          totalHares={totalHares}
          byKennel={byKennel}
          byRegion={byRegion}
          byLevel={byLevel}
          milestones={milestones}
        />
      </div>
    </div>
  );
}
