/**
 * Ad-hoc live verification for the WS1 dormant-RRULE / projection-cap fix.
 *
 * Not committed to a long-term path — used once to verify that:
 *   1. The new STATIC_SCHEDULE `futureHorizonDays` cap (default 365) bounds
 *      Mooloo's biweekly Monday expansion even when called with
 *      `options.days = 1500` (simulating an admin force-scrape).
 *   2. Re-scraping the 4 affected GCal sources produces no new phantom rows
 *      beyond the 365-day horizon for the affected kennels.
 *   3. Real titled events (#499 Knightvillian, etc.) are still present.
 *
 *   npx tsx scripts/verify-projection-cap.ts
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { StaticScheduleAdapter } from "../src/adapters/static-schedule/adapter";

async function main() {
  // --- (1) Static-schedule cap verification — Mooloo at days=1500 ---
  const mooloo = await prisma.source.findFirst({
    where: { url: "https://www.sporty.co.nz/mooloohhh", type: "STATIC_SCHEDULE" },
  });
  if (!mooloo) throw new Error("Mooloo static-schedule source not found");

  const adapter = new StaticScheduleAdapter();
  const result = await adapter.fetch(mooloo, { days: 1500 });
  const now = Date.now();
  const horizonMs = now + 365 * 86_400_000;
  const beyondHorizon = result.events.filter(
    (e) => new Date(e.date + "T12:00:00Z").getTime() > horizonMs,
  );
  console.log(`\n== Mooloo STATIC_SCHEDULE, options.days=1500 ==`);
  console.log(`  Total events generated: ${result.events.length}`);
  console.log(`  Events beyond 365d horizon: ${beyondHorizon.length} (expect 0)`);
  console.log(`  Diagnostic forwardWindowDays: ${result.diagnosticContext?.forwardWindowDays} (expect 365)`);
  console.log(`  Diagnostic windowDays:        ${result.diagnosticContext?.windowDays} (expect 1500)`);

  // --- (2) Verify post-cleanup state for all 5 kennels ---
  const kennels = ["knightvillian", "moooouston-h3", "mosquito-h3", "mihi-huha", "mooloo-h3"];
  console.log(`\n== Post-cleanup Event inventory ==`);
  for (const code of kennels) {
    const total = await prisma.event.count({
      where: { kennel: { kennelCode: code }, status: "CONFIRMED" },
    });
    const future = await prisma.event.count({
      where: {
        kennel: { kennelCode: code },
        status: "CONFIRMED",
        date: { gt: new Date() },
      },
    });
    const futureBeyondHorizon = await prisma.event.count({
      where: {
        kennel: { kennelCode: code },
        status: "CONFIRMED",
        date: { gt: new Date(Date.now() + 365 * 86_400_000) },
      },
    });
    console.log(
      `  ${code.padEnd(16)} total=${String(total).padStart(4)}  future=${String(future).padStart(3)}  beyond365d=${futureBeyondHorizon} (expect 0)`,
    );
  }

  // --- (3) Sanity: real Knightvillian trails (#499, #500) still present ---
  console.log(`\n== Knightvillian sanity: real titled trails preserved ==`);
  const realKnight = await prisma.event.findMany({
    where: {
      kennel: { kennelCode: "knightvillian" },
      runNumber: { not: null },
    },
    select: { runNumber: true, date: true, title: true },
    orderBy: { runNumber: "desc" },
    take: 5,
  });
  for (const e of realKnight) {
    console.log(
      `  #${e.runNumber}  ${e.date.toISOString().slice(0, 10)}  ${JSON.stringify(e.title)}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
