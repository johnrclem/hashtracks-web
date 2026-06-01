/**
 * One-off cleanup for CRH3 run #220 duplicate.
 *
 * Two canonical CRH3 Event rows share runNumber=220, the same blog post
 * (https://chiangraihhh.blogspot.com/2026/03/crh3220-saturday-26-march.html),
 * and the same hare ("Pussy Rainbow") — clearly the SAME real trail, split
 * across two dates by a parser change:
 *   - DELETE  2026-03-26  "Chiang Rai H3 Trail #220"  (created 2026-04-12)
 *       Ghost from the old title-date parser, which read the kennel's own typo
 *       "Saturday 26 March" literally. (26 Mar 2026 is a Thursday.)
 *   - KEEP    2026-03-28  "CRH3#220 Saturday 26 March" (created 2026-05-01)
 *       Correct row from the current body-date parser. The post body reads
 *       "Next Run #220 Saturday 28th Mar 26 (This coming Saturday)" and
 *       28 Mar 2026 is the actual Saturday — CRH3's run day.
 *
 * The fingerprint-changing parser fix (commit 0b7f7037, blog-body parsing)
 * created the Mar 28 canonical fresh and orphaned the Mar 26 one rather than
 * updating it — the classic parser-fix ghost.
 *
 * Uses the shared cascade-safe delete (scripts/lib/cascade-delete.ts):
 *   1. Unlink RawEvents (preserve immutable audit trail, reset processed=false)
 *   2. Null out parentEventId back-refs
 *   3. Delete EventHare, Attendance, KennelAttendance rows
 *   4. Delete the Event row (EventLink cascades via onDelete: Cascade)
 *
 * The merge pipeline only processes freshly-scraped events (processRawEvents
 * takes the scrape array, never a DB-wide scan of processed=false raws), and the
 * live adapter now emits body-date Mar 28 (0 events for #220 in the current
 * window), so the unlinked Mar 26 raws stay inert — no resurrection risk.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   npx tsx scripts/dedup-crh3-run-220.ts            # dry-run (default)
 *   npx tsx scripts/dedup-crh3-run-220.ts --apply    # actually delete
 *
 * Idempotent: asserts the keep row still exists and deletes only IDs still present.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const APPLY = process.argv.includes("--apply");

/**
 * Refuse to delete any event that carries attendance-like history. The shared
 * cascade helper deletes Attendance AND KennelAttendance (misman paid/hared/
 * visitor records + editLog) unconditionally, so both must be empty or we'd
 * silently destroy real check-in data. Returns the live counts for logging.
 */
async function assertNoAttendance(
  prisma: PrismaClient,
  eventIds: string[],
): Promise<{ attendances: number; kennelAttns: number }> {
  const [attendances, kennelAttns] = await Promise.all([
    prisma.attendance.count({ where: { eventId: { in: eventIds } } }),
    prisma.kennelAttendance.count({ where: { eventId: { in: eventIds } } }),
  ]);
  if (attendances > 0 || kennelAttns > 0) {
    console.error(
      `\nERROR: delete target has attendance records ` +
        `(Attendance=${attendances}, KennelAttendance=${kennelAttns}) — aborting (would lose check-ins).`,
    );
    process.exit(1);
  }
  return { attendances, kennelAttns };
}

const KEEP_ID = "cmon5wfwp001704k01938t2ga"; // 2026-03-28 (body-date, correct)
const DELETE_IDS = ["cmnw0epba000804lazldzta41"] as const; // 2026-03-26 (title-date ghost)

async function main() {
  console.log(`\n=== dedup-crh3-run-220 ===`);
  console.log(`Mode: ${APPLY ? "APPLY (will delete from DB)" : "DRY-RUN (read-only)"}`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: "crh3" },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error("crh3 kennel not found — aborting.");
      process.exit(1);
    }

    const allTargetIds = [KEEP_ID, ...DELETE_IDS];
    const existing = await prisma.event.findMany({
      where: { id: { in: allTargetIds } },
      select: {
        id: true,
        date: true,
        runNumber: true,
        title: true,
        sourceUrl: true,
        kennelId: true,
      },
      orderBy: { date: "asc" },
    });

    console.log(`\nFound ${existing.length}/${allTargetIds.length} target events:\n`);
    for (const e of existing) {
      const role = e.id === KEEP_ID ? "KEEP  " : "DELETE";
      const wrong = e.kennelId === kennel.id ? "" : " ⚠️ wrong kennel!";
      console.log(
        `  ${role}  ${e.id}  ${e.date.toISOString().split("T")[0]}  #${e.runNumber}  "${e.title ?? ""}"${wrong}`,
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

    // Guard against a mistyped DELETE_ID pointing at another kennel's event.
    const present = existing.filter(
      (e) => DELETE_IDS.includes(e.id as (typeof DELETE_IDS)[number]) && e.kennelId === kennel.id,
    );
    const presentIds = present.map((e) => e.id);

    if (presentIds.length === 0) {
      console.log("\nNothing to delete — already cleaned up.");
      return;
    }

    const [eventHares, rawEvents, { attendances, kennelAttns }] = await Promise.all([
      prisma.eventHare.count({ where: { eventId: { in: presentIds } } }),
      prisma.rawEvent.count({ where: { eventId: { in: presentIds } } }),
      assertNoAttendance(prisma, presentIds),
    ]);

    console.log(`\nFK child rows on ${presentIds.length} event(s) to delete:`);
    console.log(`  Attendance:        ${attendances}`);
    console.log(`  EventHare:         ${eventHares}`);
    console.log(`  KennelAttendance:  ${kennelAttns}`);
    console.log(`  RawEvent (unlink): ${rawEvents}`);

    if (!APPLY) {
      console.log(`\nDry-run complete. Re-run with --apply to delete ${presentIds.length} event(s).`);
      return;
    }

    console.log(`\n⚠️  APPLY mode — deleting in 3s. Ctrl-C to abort.`);
    await new Promise((r) => setTimeout(r, 3000));

    // Re-check immediately before the destructive call to shrink the race
    // window: an RSVP/check-in created during the 3s wait must still abort.
    await assertNoAttendance(prisma, presentIds);

    const deleted = await cascadeDeleteEvents(prisma, presentIds);
    console.log(`\nDeleted ${deleted} event(s).`);

    const after = await prisma.event.count({
      where: {
        kennelId: kennel.id,
        runNumber: 220,
        isCanonical: true,
      },
    });
    console.log(`Remaining canonical CRH3 run #220 events: ${after}`);
    if (after !== 1) {
      console.error(`\nERROR: expected 1 remaining run #220, got ${after}.`);
      process.exit(1);
    }
    console.log(`\nDone. ✓`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
