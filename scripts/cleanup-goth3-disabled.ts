/**
 * One-off cleanup for #1231 — delete future GOTH3 events stranded after the
 * source was disabled.
 *
 * Background: gothh3.com is NXDOMAIN. The GOTH3 source was a STATIC_SCHEDULE
 * adapter that generated future events from an rrule without ever fetching
 * the dead URL. Disabling the source (PR #1306) stops further generation but
 * leaves any already-generated future events in the DB. Without cleanup, the
 * Hareline keeps showing "GOTH3 Monthly Run" placeholders that link to a
 * NXDOMAIN URL.
 *
 * Targets: future, CONFIRMED canonical Events for kennel `goth3` (i.e.
 * `date >= today` and `status = CONFIRMED`). Past events are left alone —
 * they predate the disable and represent historical attendance opportunities.
 *
 * Uses the same cascade-safe semantics as bulkDeleteEvents() / the cleanup
 * pattern from scripts/cleanup-stale-future-events-973.ts.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-goth3-disabled.ts            # dry-run (default)
 *   npx tsx scripts/cleanup-goth3-disabled.ts --execute  # actually delete
 *
 * IMPORTANT: .env must point at Railway prod for deletions to take effect.
 * Dry-run is always safe and prints counts without writing.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const EXECUTE = process.argv.includes("--execute");
const KENNEL_CODE = "goth3";

async function main() {
  const mode = EXECUTE ? "EXECUTE (will delete from DB)" : "DRY-RUN (read-only)";
  console.log(`\n=== cleanup-goth3-disabled ===`);
  console.log(`Mode: ${mode}`);

  if (EXECUTE) {
    console.log("⚠️  EXECUTE MODE — DB writes will occur. Press Ctrl-C within 3s to abort.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: KENNEL_CODE },
      select: { id: true, shortName: true },
    });
    if (!kennel) {
      console.error(`Kennel "${KENNEL_CODE}" not found — aborting.`);
      process.exitCode = 1;
      return;
    }

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const where = {
      kennelId: kennel.id,
      date: { gte: today },
      status: "CONFIRMED" as const,
      isCanonical: true,
    };

    const [count, withAttendance, range] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.count({ where: { ...where, attendances: { some: {} } } }),
      prisma.event.aggregate({
        where,
        _min: { date: true },
        _max: { date: true },
      }),
    ]);

    const min = range._min.date?.toISOString().split("T")[0] ?? "—";
    const max = range._max.date?.toISOString().split("T")[0] ?? "—";
    console.log(`Kennel: ${kennel.shortName} (${KENNEL_CODE})`);
    console.log(`Future CONFIRMED events: ${count} (range ${min} → ${max})`);
    if (withAttendance > 0) {
      console.log(`⚠️  ${withAttendance} have Attendance records — review before executing.`);
    }

    if (count === 0) {
      console.log("Nothing to clean up.");
      return;
    }

    if (!EXECUTE) {
      console.log("\nDry-run complete. Re-run with --execute to delete.");
      return;
    }

    const ids = (
      await prisma.event.findMany({ where, select: { id: true } })
    ).map((e) => e.id);
    const deleted = await cascadeDeleteEvents(prisma, ids);
    console.log(`Deleted ${deleted} events.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
