import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
  });
  const prisma = new PrismaClient({ adapter });

  console.log("=== Merge Verification ===\n");

  // 1. Verify NYC H3 is deleted
  const deleted = await prisma.kennel.findUnique({
    where: { shortName: "NYC H3" },
  });
  console.log("NYC H3 deleted:", deleted === null ? "✅ Yes" : "❌ No");

  // 2. Verify NYCH3 has all events
  const nych3 = await prisma.kennel.findUnique({
    where: { shortName: "NYCH3" },
    include: { _count: { select: { events: true } } },
  });
  if (!nych3) {
    console.error("❌ NYCH3 kennel not found!");
    return;
  }
  console.log("NYCH3 event count:", nych3._count.events, "events");

  // 3. Verify event date range
  const events = await prisma.event.findMany({
    where: { kennelId: nych3.id },
    orderBy: { date: "asc" },
    select: { date: true },
  });
  const minDate = events[0]?.date.toISOString().split("T")[0];
  const maxDate = events[events.length - 1]?.date.toISOString().split("T")[0];
  console.log("Event date range:", minDate, "→", maxDate);

  // 4. Verify alias exists
  const aliases = await prisma.kennelAlias.findMany({
    where: { kennelId: nych3.id },
    select: { alias: true },
  });
  const hasAlias = aliases.some((a) => a.alias === "NYC H3");
  console.log("NYC H3 alias exists:", hasAlias ? "✅ Yes" : "❌ No");
  console.log("All aliases:", aliases.map((a) => a.alias).join(", "));

  // 5. Count recent events (Aug 2025+)
  const recentCount = await prisma.event.count({
    where: {
      kennelId: nych3.id,
      date: { gte: new Date("2025-08-01T00:00:00Z") },
    },
  });
  console.log("Recent events (Aug 2025+):", recentCount, "events");

  // 6. Show some recent event titles
  const recentEvents = await prisma.event.findMany({
    where: {
      kennelId: nych3.id,
      date: { gte: new Date("2025-08-01T00:00:00Z") },
    },
    orderBy: { date: "asc" },
    select: { date: true, title: true, runNumber: true },
    take: 5,
  });
  console.log("\nSample recent events:");
  recentEvents.forEach((e) => {
    const dateStr = e.date.toISOString().split("T")[0];
    console.log(`  ${dateStr} | #${e.runNumber} | ${e.title || "(no title)"}`);
  });

  console.log("\n✅ Merge verification complete!");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Verification error:", err);
  process.exit(1);
});
