import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "hhhorrors" } });
  if (!kennel) throw new Error("kennel not found");

  const fmt = (e: { runNumber: number | null; date: Date; title: string | null; locationName: string | null; haresText: string | null }) =>
    `  #${e.runNumber} ${e.date.toISOString().slice(0, 10)} | ${e.title ?? "—"} | hares=${e.haresText ?? "—"} | loc=${e.locationName ?? "—"}`;

  const oldest = await prisma.event.findMany({
    where: { eventKennels: { some: { kennelId: kennel.id } } },
    orderBy: { date: "asc" },
    take: 5,
    select: { runNumber: true, date: true, title: true, locationName: true, haresText: true },
  });
  console.log("Oldest 5:");
  for (const e of oldest) console.log(fmt(e));

  const recent = await prisma.event.findMany({
    where: {
      eventKennels: { some: { kennelId: kennel.id } },
      date: { lt: new Date("2026-05-21T00:00:00Z") },
    },
    orderBy: { date: "desc" },
    take: 5,
    select: { runNumber: true, date: true, title: true, locationName: true, haresText: true },
  });
  console.log("\nNewest 5 (past):");
  for (const e of recent) console.log(fmt(e));

  const upcoming = await prisma.event.findMany({
    where: {
      eventKennels: { some: { kennelId: kennel.id } },
      date: { gte: new Date("2026-05-21T00:00:00Z") },
    },
    orderBy: { date: "asc" },
    select: { runNumber: true, date: true, title: true, locationName: true, haresText: true },
  });
  console.log("\nUpcoming:");
  for (const e of upcoming) console.log(fmt(e));

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
