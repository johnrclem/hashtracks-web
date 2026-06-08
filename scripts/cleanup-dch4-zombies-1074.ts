/**
 * One-shot cleanup for issue #1074 — DCH4 zombie upcoming events.
 *
 * DCH4 post titles often omit the year ("DCH4 Trail# 2294 - 12/20 @ 5pm"). The
 * adapter previously defaulted the year to the *current* year, so an old
 * December run that resurfaced in a later post was stamped into a *future*
 * December (#2294 → 2026-12-20). That zombie outranked the real latest run
 * (#2310, May 2026) and drove the kennel's "Latest Run" header to 2294. A
 * second zombie (a null-runNumber Dec 23 row) showed the same shape.
 *
 * The adapter fix in this PR (publish-date-anchored year inference,
 * `inferDch4Year`) stops new occurrences, but the existing zombies are future
 * rows the reconciler won't touch (HTML_SCRAPER reconcile against a wider
 * window would cancel legitimate past runs). This script removes them in place.
 *
 * Signature (re-runnable, not id-pinned): a future-dated DCH4 event whose run
 * number is absent OR <= the highest *past* run number. A genuine future run
 * always has a higher number than every past run, so this only ever matches
 * mis-dated rows.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dch4-zombies-1074.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dch4-zombies-1074.ts --apply
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(apply ? "✏️  APPLYING changes" : "🔍 DRY RUN — no changes will be made");

  const pool = createScriptPool();
  try {
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    const kennel = await prisma.kennel.findUnique({
      where: { kennelCode: "dch4" },
      select: { id: true },
    });
    if (!kennel) {
      console.log('Kennel "dch4" not found — nothing to do.');
      return;
    }

    const now = new Date();
    // Highest run number among PAST events — a real future run must exceed it.
    const pastAgg = await prisma.event.aggregate({
      where: { kennelId: kennel.id, date: { lte: now }, runNumber: { not: null } },
      _max: { runNumber: true },
    });
    const maxPastRun = pastAgg._max.runNumber ?? 0;
    console.log(`Highest past DCH4 run number: #${maxPastRun}`);

    const future = await prisma.event.findMany({
      where: { kennelId: kennel.id, date: { gt: now } },
      select: { id: true, runNumber: true, date: true, title: true },
      orderBy: { date: "asc" },
    });

    const zombies = future.filter((e) => e.runNumber == null || e.runNumber <= maxPastRun);
    console.log(`Future DCH4 events: ${future.length}; zombies (run# absent or <= #${maxPastRun}): ${zombies.length}`);
    for (const e of zombies) {
      console.log(
        `  DELETE  ${e.id}  ${e.date.toISOString().slice(0, 10)}  run=${e.runNumber ?? "—"}  ${JSON.stringify(e.title)}`,
      );
    }

    if (apply && zombies.length > 0) {
      const deleted = await cascadeDeleteEvents(prisma, zombies.map((e) => e.id));
      console.log(`\n✓ Deleted ${deleted} zombie event(s).`);
      const touched = await backfillLastEventDates();
      console.log(`✓ Recomputed lastEventDate for ${touched} kennel(s).`);
    } else if (!apply) {
      console.log("\nRun with --apply to commit changes.");
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
