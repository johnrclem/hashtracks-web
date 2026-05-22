/**
 * Post-merge live verification for PR #1622.
 * Reads from prod via DATABASE_URL — no network calls to hashtracks.xyz itself.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

async function main() {
  const codes = ["bsh3", "mlh4", "hmh3", "cunth3-atl"];

  console.log("═══ Profile-field verification ═══\n");
  for (const code of codes) {
    const k = await prisma.kennel.findUnique({
      where: { kennelCode: code },
      select: {
        shortName: true,
        scheduleDayOfWeek: true, scheduleTime: true, scheduleNotes: true,
        hashCash: true, description: true,
        aliases: { select: { alias: true } },
      },
    });
    if (!k) continue;
    console.log(`▸ ${k.shortName} (${code})`);
    console.log(`    day: ${k.scheduleDayOfWeek ?? "(null)"} | time: ${k.scheduleTime ?? "(null)"} | hashCash: ${k.hashCash ?? "(null)"}`);
    if (k.scheduleNotes) console.log(`    notes: ${k.scheduleNotes}`);
    console.log(`    description: ${(k.description ?? "").slice(0, 110)}${(k.description?.length ?? 0) > 110 ? "…" : ""}`);
    if (code === "bsh3") {
      const hasRainbow = k.aliases.some((a) => a.alias === "Rainbow Sheep");
      console.log(`    Rainbow Sheep alias: ${hasRainbow ? "✓ present" : "✗ MISSING"}`);
    }
    console.log("");
  }

  console.log("═══ Source URLs (dead-anchor fix) ═══\n");
  const srcs = await prisma.source.findMany({
    where: { name: { in: ["HMH3 Static Schedule", "CUNT H3 ATL Static Schedule"] } },
    select: { name: true, url: true },
    orderBy: { name: "asc" },
  });
  for (const s of srcs) {
    const ok = !s.url.includes("#");
    console.log(`▸ ${s.name}: ${s.url} ${ok ? "✓" : "✗ DEAD ANCHOR"}`);
  }

  console.log("\n═══ MLH4 ghost-events spot check ═══\n");
  const mlh4 = await prisma.kennel.findUnique({ where: { kennelCode: "mlh4" }, select: { id: true } });
  if (mlh4) {
    const ghostDates = ["2026-03-30", "2026-04-20", "2026-05-04", "2026-05-11"];
    for (const date of ghostDates) {
      const ek = await prisma.eventKennel.findFirst({
        where: { kennelId: mlh4.id, event: { date: new Date(date + "T12:00:00Z") } },
        select: { event: { select: { runNumber: true, startTime: true, title: true } } },
      });
      if (!ek) { console.log(`  ${date}: (no event)`); continue; }
      const { runNumber, startTime, title } = ek.event;
      // Original wrong values: 2000, 946, 22:36, 15:19
      const wrongRun = runNumber != null && [946, 2000, 420].includes(runNumber);
      const wrongTime = startTime != null && ["22:36", "15:19"].includes(startTime);
      const status = (wrongRun || wrongTime) ? "✗ STILL WRONG" : "✓ clean";
      console.log(`  ${date}  runNumber=${runNumber ?? "(null)"}  startTime=${startTime ?? "(null)"}  ${status}`);
      console.log(`           ${(title ?? "").slice(0, 60)}`);
    }
  }

  console.log("\n═══ Event counts ═══\n");
  for (const code of ["mlh4", "bsh3"]) {
    const k = await prisma.kennel.findUnique({ where: { kennelCode: code }, select: { id: true, shortName: true } });
    if (!k) continue;
    const total = await prisma.eventKennel.count({ where: { kennelId: k.id } });
    const past = await prisma.eventKennel.count({ where: { kennelId: k.id, event: { date: { lt: new Date() } } } });
    const future = total - past;
    console.log(`▸ ${k.shortName}: ${total} total (${past} past, ${future} upcoming)`);
  }

  console.log("\n═══ MLH4 latest run number ═══\n");
  if (mlh4) {
    // Latest = highest runNumber among events with non-null runNumber.
    const withRunNo = await prisma.eventKennel.findMany({
      where: { kennelId: mlh4.id, event: { runNumber: { not: null } } },
      select: { event: { select: { date: true, runNumber: true, title: true } } },
      orderBy: { event: { date: "desc" } },
      take: 5,
    });
    if (withRunNo.length === 0) {
      console.log("  (no events with runNumber set)");
    } else {
      console.log("  date        runNo  title");
      for (const ek of withRunNo) {
        const e = ek.event;
        console.log(`  ${e.date.toISOString().slice(0, 10)}  ${String(e.runNumber).padEnd(5)}  ${(e.title ?? "").slice(0, 60)}`);
      }
    }
  }
}
main().finally(() => prisma.$disconnect());
