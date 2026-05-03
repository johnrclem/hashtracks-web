/**
 * Repair past Gold Coast H3 (gch3-au) events that the reconcile pipeline
 * stale-cancelled before #1229 added `upcomingOnly: true` to the source row.
 *
 * The Gold Coast TablePress hareline strips past rows automatically — every
 * scrape after a run made the canonical Event look "missing from source",
 * which the reconciler then marked CANCELLED. The fix flips
 * `upcomingOnly: true` so reconcile no longer cancels past rows; this
 * script un-cancels the events that were already wrongly marked.
 *
 * Usage:
 *   npx tsx scripts/uncancel-gch3-stale.ts            # dry-run (default)
 *   npx tsx scripts/uncancel-gch3-stale.ts --apply    # write changes
 *
 * Filter rules — only events that match ALL of these are touched:
 *   - kennel.kennelCode = "gch3-au"
 *   - status = "CANCELLED"
 *   - adminCancelledAt IS NULL  (don't override admin-driven cancellations)
 *   - date < today              (the reconcile bug only affects past events)
 *
 * Closes #1229.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const KENNEL_CODE = "gch3-au";
const APPLY = process.argv.includes("--apply");

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    const kennel = await prisma.kennel.findFirst({
      where: { kennelCode: KENNEL_CODE },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error(`Kennel "${KENNEL_CODE}" not found in database.`);
      process.exit(1);
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const candidates = await prisma.event.findMany({
      where: {
        kennelId: kennel.id,
        status: "CANCELLED",
        adminCancelledAt: null,
        date: { lt: today },
      },
      select: {
        id: true,
        date: true,
        runNumber: true,
        title: true,
        updatedAt: true,
      },
      orderBy: { date: "asc" },
    });

    if (candidates.length === 0) {
      console.log("No stale-cancelled gch3-au events found. Nothing to do.");
      return;
    }

    console.log(
      `Found ${candidates.length} stale-cancelled gch3-au event(s):\n`,
    );
    for (const e of candidates) {
      const dateStr = e.date.toISOString().slice(0, 10);
      console.log(
        `  ${e.id}  ${dateStr}  #${e.runNumber ?? "?"}  ${e.title ?? "(no title)"}`,
      );
    }

    if (!APPLY) {
      console.log("\n--- DRY RUN ---");
      console.log("Re-run with --apply to flip these events to CONFIRMED.");
      return;
    }

    const ids = candidates.map((c) => c.id);
    const result = await prisma.event.updateMany({
      where: { id: { in: ids }, status: "CANCELLED", adminCancelledAt: null },
      data: { status: "CONFIRMED" },
    });
    console.log(`\nFlipped ${result.count} event(s) back to CONFIRMED.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
