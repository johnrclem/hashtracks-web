import "dotenv/config";
import { prisma } from "@/lib/db";

/**
 * One-shot reconciler for #1023 step-1/step-2 deploy-window orphans.
 *
 * The original step-1 migration (`20260428024100_backfill_event_kennel_from_kennel_id`)
 * backfilled an EventKennel primary row for every Event that existed when it
 * ran. The migration was applied to prod at 2026-04-28T02:50:32Z (via a Vercel
 * preview-branch build of `feat/event-kennel-join-table`). The step-2 dual-write
 * application code did not deploy to prod until ~14h later when PR #1099 merged
 * to main at 2026-04-28T17:06:05Z. In that intervening window the merge
 * pipeline kept running its pre-dual-write code path, creating Events without
 * an EventKennel row. As of 2026-04-30 there are 309 such orphans (all
 * createdAt between 2026-04-28T03:00:07Z and 2026-04-28T17:03:50Z).
 *
 * Event.kennelId is correct on every orphan (the merge pipeline set it the
 * normal way), so the fix is a literal re-run of the original backfill
 * INSERT, scoped to Events lacking a primary EK row. Idempotent via the
 * partial unique index — re-running is safe.
 *
 * Run:
 *   DATABASE_URL=$PROD_DATABASE_URL npx tsx scripts/reconcile-missing-event-kennel-primaries.ts          # dry-run
 *   DATABASE_URL=$PROD_DATABASE_URL npx tsx scripts/reconcile-missing-event-kennel-primaries.ts --apply  # write
 */
const APPLY = process.argv.includes("--apply");

async function main() {
  const before = await prisma.$queryRaw<{ orphans: bigint }[]>`
    SELECT COUNT(*)::bigint AS orphans
    FROM "Event" e
    WHERE NOT EXISTS (
      SELECT 1 FROM "EventKennel" ek
      WHERE ek."eventId" = e.id AND ek."isPrimary" = true
    )
  `;
  const orphanCount = Number(before[0].orphans);
  console.log(`Orphans before: ${orphanCount}`);

  if (orphanCount === 0) {
    console.log("Nothing to do.");
    return;
  }

  if (!APPLY) {
    // Show the kennels that will receive new EK rows.
    const byKennel = await prisma.$queryRaw<{ shortName: string; count: bigint }[]>`
      SELECT k."shortName", COUNT(*)::bigint AS count
      FROM "Event" e
      JOIN "Kennel" k ON k.id = e."kennelId"
      WHERE NOT EXISTS (
        SELECT 1 FROM "EventKennel" ek
        WHERE ek."eventId" = e.id AND ek."isPrimary" = true
      )
      GROUP BY k."shortName"
      ORDER BY count DESC
    `;
    console.log("\nDRY RUN — would insert EK rows for these kennels:");
    for (const row of byKennel) {
      console.log(`  ${row.shortName.padEnd(30)} ${row.count}`);
    }
    console.log("\nRe-run with --apply to write.");
    return;
  }

  // Same SQL the original migration used. ON CONFLICT DO UPDATE handles the
  // edge case where a non-primary EventKennel(eventId, kennelId) row was
  // created in between (e.g. by historical co-host backfill writing a
  // co-host link first) — promote it to primary.
  const result = await prisma.$executeRaw`
    INSERT INTO "EventKennel" ("eventId", "kennelId", "isPrimary")
    SELECT e."id", e."kennelId", true
    FROM "Event" e
    WHERE NOT EXISTS (
      SELECT 1 FROM "EventKennel" ek
      WHERE ek."eventId" = e.id AND ek."isPrimary" = true
    )
    ON CONFLICT ("eventId", "kennelId") DO UPDATE
      SET "isPrimary" = true
  `;
  console.log(`Inserted/promoted: ${result} rows`);

  const after = await prisma.$queryRaw<{ orphans: bigint }[]>`
    SELECT COUNT(*)::bigint AS orphans
    FROM "Event" e
    WHERE NOT EXISTS (
      SELECT 1 FROM "EventKennel" ek
      WHERE ek."eventId" = e.id AND ek."isPrimary" = true
    )
  `;
  console.log(`Orphans after:  ${after[0].orphans}`);

  if (Number(after[0].orphans) !== 0) {
    throw new Error(`Reconciler did not zero out orphans — ${after[0].orphans} remain. Investigate.`);
  }
  console.log("\nAll Events now have a primary EventKennel row ✓");
}

main()
  .catch((err) => {
    console.error("\nReconciler failed:");
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
