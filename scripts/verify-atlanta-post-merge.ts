/**
 * Post-merge live verification for PR #1622.
 * Reads from prod via DATABASE_URL — no network calls to hashtracks.xyz itself.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const KENNEL_CODES = ["bsh3", "mlh4", "hmh3", "cunth3-atl"];
const ATL_SOURCE_NAMES = ["HMH3 Static Schedule", "CUNT H3 ATL Static Schedule"];
const MLH4_GHOST_DATES = ["2026-03-30", "2026-04-20", "2026-05-04", "2026-05-11"];
const WRONG_RUN_NUMBERS = new Set([946, 2000, 420]);
const WRONG_START_TIMES = new Set(["22:36", "15:19"]);

async function verifyProfileFields(): Promise<void> {
  console.log("═══ Profile-field verification ═══\n");
  for (const code of KENNEL_CODES) {
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
    const descSnippet = (k.description ?? "").slice(0, 110);
    const descEllipsis = (k.description?.length ?? 0) > 110 ? "…" : "";
    console.log(`▸ ${k.shortName} (${code})`);
    console.log(`    day: ${k.scheduleDayOfWeek ?? "(null)"} | time: ${k.scheduleTime ?? "(null)"} | hashCash: ${k.hashCash ?? "(null)"}`);
    if (k.scheduleNotes) console.log(`    notes: ${k.scheduleNotes}`);
    console.log(`    description: ${descSnippet}${descEllipsis}`);
    if (code === "bsh3") {
      const hasRainbow = k.aliases.some((a) => a.alias === "Rainbow Sheep");
      console.log(`    Rainbow Sheep alias: ${hasRainbow ? "✓ present" : "✗ MISSING"}`);
    }
    console.log("");
  }
}

async function verifySourceUrls(): Promise<void> {
  console.log("═══ Source URLs (dead-anchor fix) ═══\n");
  const srcs = await prisma.source.findMany({
    where: { name: { in: ATL_SOURCE_NAMES } },
    select: { name: true, url: true },
    orderBy: { name: "asc" },
  });
  for (const s of srcs) {
    const ok = !s.url.includes("#");
    console.log(`▸ ${s.name}: ${s.url} ${ok ? "✓" : "✗ DEAD ANCHOR"}`);
  }
}

async function verifyGhostEvents(mlh4Id: string): Promise<void> {
  console.log("\n═══ MLH4 ghost-events spot check ═══\n");
  for (const date of MLH4_GHOST_DATES) {
    // findMany not findFirst — multiple Event rows can exist for a single
    // kennel/date in conflict/audit cases. If any of them still carries a
    // wrong value, the date isn't clean (CodeRabbit PR #1629 review).
    const eks = await prisma.eventKennel.findMany({
      where: { kennelId: mlh4Id, event: { date: new Date(date + "T12:00:00Z") } },
      select: { event: { select: { id: true, runNumber: true, startTime: true, title: true } } },
    });
    if (eks.length === 0) { console.log(`  ${date}: (no event)`); continue; }
    const wrong = eks.some(({ event }) =>
      (event.runNumber != null && WRONG_RUN_NUMBERS.has(event.runNumber))
      || (event.startTime != null && WRONG_START_TIMES.has(event.startTime))
    );
    const status = wrong ? "✗ STILL WRONG" : "✓ clean";
    console.log(`  ${date}  rows=${eks.length}  ${status}`);
    for (const { event } of eks) {
      console.log(
        `           id=${event.id}  runNumber=${event.runNumber ?? "(null)"}  startTime=${event.startTime ?? "(null)"}  ${(event.title ?? "").slice(0, 60)}`,
      );
    }
  }
}

async function printEventCounts(): Promise<void> {
  console.log("\n═══ Event counts ═══\n");
  const now = new Date();
  for (const code of ["mlh4", "bsh3"]) {
    const k = await prisma.kennel.findUnique({ where: { kennelCode: code }, select: { id: true, shortName: true } });
    if (!k) continue;
    const total = await prisma.eventKennel.count({ where: { kennelId: k.id } });
    const past = await prisma.eventKennel.count({ where: { kennelId: k.id, event: { date: { lt: now } } } });
    const future = total - past;
    console.log(`▸ ${k.shortName}: ${total} total (${past} past, ${future} upcoming)`);
  }
}

async function printLatestRunNumber(mlh4Id: string): Promise<void> {
  console.log("\n═══ MLH4 latest run number ═══\n");
  const withRunNo = await prisma.eventKennel.findMany({
    where: { kennelId: mlh4Id, event: { runNumber: { not: null } } },
    select: { event: { select: { date: true, runNumber: true, title: true } } },
    orderBy: { event: { date: "desc" } },
    take: 5,
  });
  if (withRunNo.length === 0) {
    console.log("  (no events with runNumber set)");
    return;
  }
  console.log("  date        runNo  title");
  for (const ek of withRunNo) {
    const e = ek.event;
    const runNoStr = String(e.runNumber).padEnd(5);
    console.log(`  ${e.date.toISOString().slice(0, 10)}  ${runNoStr}  ${(e.title ?? "").slice(0, 60)}`);
  }
}

async function main() {
  await verifyProfileFields();
  await verifySourceUrls();
  const mlh4 = await prisma.kennel.findUnique({ where: { kennelCode: "mlh4" }, select: { id: true } });
  if (mlh4) {
    await verifyGhostEvents(mlh4.id);
  }
  await printEventCounts();
  if (mlh4) {
    await printLatestRunNumber(mlh4.id);
  }
}
main()
  .catch((e) => { console.warn(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
