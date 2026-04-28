/**
 * One-off cleanup for ch4-dk run #260 duplicates (closes #1050).
 *
 * Four CH4 Event rows share (runNumber=260, locationName="Dybbølsbro, Denmark",
 * title="ch4 run#260 Gispert") on different dates — clearly old import
 * artifacts. The 2012-02-11 row is the legitimate one (founded 1995, monthly
 * full moon ≈ #260 in early 2012); the 2013/2014/2017 rows are duplicates.
 *
 * Uses the same cascade-safe delete semantics as bulkDeleteEvents() and
 * cleanup-stale-future-events-973.ts:
 *   1. Unlink RawEvents (preserve immutable audit trail, reset processed=false)
 *   2. Null out parentEventId back-refs
 *   3. Delete EventHare, Attendance, KennelAttendance rows
 *   4. Delete the Event rows (EventLink cascades via onDelete: Cascade)
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   npx tsx scripts/dedup-ch4-dk-run-260.ts            # dry-run (default)
 *   npx tsx scripts/dedup-ch4-dk-run-260.ts --apply    # actually delete
 *
 * Idempotent: safe to re-run; it asserts the keep row still exists and
 * deletes only IDs that are still present.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const APPLY = process.argv.includes("--apply");

const KEEP_ID = "cmof67ust0001fdhnriaqlalr"; // 2012-02-11
const DELETE_IDS = [
  "cmof68dhf0035fdhng7d4cmkq", // 2013-02-11
  "cmof68v5x006nfdhnd5uftthg", // 2014-02-11
  "cmof6ao4o00khfdhnittmr049", // 2017-02-11
] as const;

async function main() {
  console.log(`\n=== dedup-ch4-dk-run-260 ===`);
  console.log(`Mode: ${APPLY ? "APPLY (will delete from DB)" : "DRY-RUN (read-only)"}`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: "ch4-dk" },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error("ch4-dk kennel not found — aborting.");
      process.exit(1);
    }

    const allTargetIds = [KEEP_ID, ...DELETE_IDS];
    const existing = await prisma.event.findMany({
      where: { id: { in: allTargetIds } },
      select: {
        id: true,
        date: true,
        runNumber: true,
        locationName: true,
        title: true,
        kennelId: true,
      },
      orderBy: { date: "asc" },
    });

    console.log(`\nFound ${existing.length}/4 target events:\n`);
    for (const e of existing) {
      const role = e.id === KEEP_ID ? "KEEP " : "DELETE";
      const wrong = e.kennelId === kennel.id ? "" : " ⚠️ wrong kennel!";
      console.log(
        `  ${role}  ${e.id}  ${e.date.toISOString().split("T")[0]}  #${e.runNumber}  ${e.locationName ?? "(no loc)"}${wrong}`,
      );
    }

    const keepRow = existing.find((e) => e.id === KEEP_ID);
    if (!keepRow) {
      console.error(`\nERROR: keep row ${KEEP_ID} no longer exists — aborting.`);
      process.exit(1);
    }
    if (keepRow.kennelId !== kennel.id) {
      console.error(`\nERROR: keep row is on a different kennel — aborting.`);
      process.exit(1);
    }

    const present = existing
      .filter((e) => DELETE_IDS.includes(e.id as typeof DELETE_IDS[number]))
      .filter((e) => e.kennelId === kennel.id);
    const presentIds = present.map((e) => e.id);

    if (presentIds.length === 0) {
      console.log("\nNothing to delete — already cleaned up.");
      return;
    }

    const [attendances, eventHares, kennelAttns, rawEvents] = await Promise.all([
      prisma.attendance.count({ where: { eventId: { in: presentIds } } }),
      prisma.eventHare.count({ where: { eventId: { in: presentIds } } }),
      prisma.kennelAttendance.count({ where: { eventId: { in: presentIds } } }),
      prisma.rawEvent.count({ where: { eventId: { in: presentIds } } }),
    ]);

    console.log(`\nFK child rows on ${presentIds.length} events to delete:`);
    console.log(`  Attendance:        ${attendances}`);
    console.log(`  EventHare:         ${eventHares}`);
    console.log(`  KennelAttendance:  ${kennelAttns}`);
    console.log(`  RawEvent (unlink): ${rawEvents}`);

    if (!APPLY) {
      console.log(`\nDry-run complete. Re-run with --apply to delete ${presentIds.length} events.`);
      return;
    }

    console.log(`\n⚠️  APPLY mode — deleting in 3s. Ctrl-C to abort.`);
    await new Promise((r) => setTimeout(r, 3000));

    const deleted = await cascadeDeleteEvents(prisma, presentIds);
    console.log(`\nDeleted ${deleted} events.`);

    const after = await prisma.event.count({
      where: { kennelId: kennel.id, runNumber: 260 },
    });
    console.log(`Remaining CH4 run #260 events: ${after}`);
    if (after !== 1) {
      console.error(`\nERROR: expected 1 remaining run #260, got ${after}.`);
      process.exit(1);
    }
    console.log(`\nDone. ✓`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
