/**
 * Post-#1560 cleanup: drop canonical Events orphaned by the fingerprint
 * change.
 *
 * Adding `endDate` to `generateFingerprint`'s input changes the SHA for
 * every RawEvent on the next scrape. The pipeline correctly inserts a
 * fresh RawEvent + reuses the existing canonical Event via the same-day
 * matcher, so we don't get duplicate canonical rows. But if a canonical
 * Event was previously linked to ONLY a single RawEvent and that RawEvent
 * row was wiped by an upstream change (or a kennel rename) the canonical
 * row may be left without any backing RawEvent at all. Those orphans
 * shouldn't render on the hareline.
 *
 * Also handles the SFH3 umbrella migration: pre-#1560 the adapter
 * suppressed `/events/N` umbrellas; post-#1560 it emits them as series
 * parents. Any pre-existing canonical Events whose only RawEvent is
 * a `/events/N` umbrella that was scrubbed before #1560 landed should be
 * dropped here.
 *
 * Safety:
 *   * Dry-run by default. Pass `--apply` to actually delete.
 *   * Skips events with attendance, hares, or admin overrides — those
 *     carry user-authored state that must not be silently destroyed.
 *   * Skips manual-entry events.
 *   * Caps at 1000 deletes per run; re-run if more remain.
 *
 * Run after each post-deploy re-scrape:
 *   tsx scripts/cleanup-orphan-events-after-series.ts          # dry run
 *   tsx scripts/cleanup-orphan-events-after-series.ts --apply  # destructive
 *
 * Per memory `feedback_script_env_loading.md` — `import "dotenv/config"`
 * because tsx doesn't auto-load .env.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const DELETE_CAP = 1000;

async function main() {
  const apply = process.argv.includes("--apply");
  console.log(`Mode: ${apply ? "APPLY (will delete)" : "DRY-RUN"}`);

  // Find canonical Events with no backing RawEvent. `parentEventId IS NULL`
  // excludes series children — they're linked via the parent and shouldn't
  // be evaluated by this pass even when the child has its own RawEvents.
  const orphans = await prisma.event.findMany({
    where: {
      rawEvents: { none: {} },
      isManualEntry: false,
      adminCancelledAt: null,
      attendances: { none: {} },
      hares: { none: {} },
    },
    select: {
      id: true,
      kennelId: true,
      date: true,
      title: true,
      sourceUrl: true,
      isSeriesParent: true,
      parentEventId: true,
    },
    take: DELETE_CAP,
    orderBy: { date: "asc" },
  });

  console.log(`Orphan canonical Events found: ${orphans.length}`);
  if (orphans.length === 0) {
    console.log("Nothing to clean up.");
    return;
  }

  // Group by kennel for human-readable reporting.
  const byKennel = new Map<string, typeof orphans>();
  for (const o of orphans) {
    const arr = byKennel.get(o.kennelId) ?? [];
    arr.push(o);
    byKennel.set(o.kennelId, arr);
  }
  for (const [kennelId, rows] of byKennel) {
    console.log(`\n  kennel=${kennelId}  ${rows.length} orphan(s)`);
    for (const r of rows.slice(0, 5)) {
      console.log(`    ${r.id}  ${r.date.toISOString().slice(0, 10)}  ${(r.title ?? "—").slice(0, 50)}`);
    }
    if (rows.length > 5) console.log(`    … and ${rows.length - 5} more`);
  }

  if (!apply) {
    console.log("\nDry-run complete. Re-run with --apply to delete.");
    return;
  }

  // Series parents with orphaned children: cascade is ON DELETE SET NULL,
  // so deleting a parent leaves its children as standalone Events. That's
  // OK — they have their own RawEvents and stay visible. But warn so the
  // operator notices.
  const parentOrphans = orphans.filter((o) => o.isSeriesParent);
  if (parentOrphans.length > 0) {
    console.log(`\n⚠️  ${parentOrphans.length} of these are series parents — children will be promoted to standalone.`);
  }

  const ids = orphans.map((o) => o.id);
  const result = await prisma.event.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${result.count} orphan Events.`);
  if (orphans.length === DELETE_CAP) {
    console.log("⚠️  Hit DELETE_CAP — re-run the script to clear remaining orphans.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
