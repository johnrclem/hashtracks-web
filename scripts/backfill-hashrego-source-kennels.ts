/**
 * One-time backfill: create missing SourceKennel rows for HASHREGO discoveries
 * that were auto-matched before the sync pipeline started linking them.
 *
 * Context: issue #548 — `syncKennelDiscovery` used to write MATCHED state to
 * KennelDiscovery without creating a SourceKennel link, leaving ~180 matched
 * slugs invisible to the scraper.
 *
 * Usage:
 *   npx tsx scripts/backfill-hashrego-source-kennels.ts          # dry run (default)
 *   npx tsx scripts/backfill-hashrego-source-kennels.ts --apply   # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

type EligibleDiscovery = {
  externalSlug: string;
  matchedKennelId: string | null;
  status: string;
  lastSeenAt: Date | null;
  processedAt: Date | null;
};

const STATUS_PRIORITY: Record<string, number> = { LINKED: 3, ADDED: 2, MATCHED: 1 };

/**
 * Pick one canonical discovery per matchedKennelId, dropping any kennel that
 * already has a SourceKennel row. Tie-breakers: status priority
 * (LINKED > ADDED > MATCHED), then most recent processedAt, then most recent
 * lastSeenAt. Returns the picks plus the pre-dedupe eligible count so the
 * caller can report a "collapsed" delta without re-filtering.
 */
function dedupeByKennel(
  discoveries: EligibleDiscovery[],
  alreadyLinked: Set<string>,
): { picks: EligibleDiscovery[]; eligibleCount: number } {
  const byKennel = new Map<string, EligibleDiscovery>();
  let eligibleCount = 0;
  for (const d of discoveries) {
    if (!d.matchedKennelId) continue;
    const kid = d.matchedKennelId;
    if (alreadyLinked.has(kid)) continue;
    eligibleCount++;
    const cur = byKennel.get(kid);
    if (!cur) {
      byKennel.set(kid, d);
      continue;
    }
    const curScore = STATUS_PRIORITY[cur.status] ?? 0;
    const dScore = STATUS_PRIORITY[d.status] ?? 0;
    if (dScore !== curScore) {
      if (dScore > curScore) byKennel.set(kid, d);
      continue;
    }
    const curTime = (cur.processedAt ?? cur.lastSeenAt ?? new Date(0)).getTime();
    const dTime = (d.processedAt ?? d.lastSeenAt ?? new Date(0)).getTime();
    if (dTime > curTime) byKennel.set(kid, d);
  }
  return { picks: [...byKennel.values()], eligibleCount };
}

/**
 * Upsert SourceKennel rows for the given discoveries. Each upsert is keyed on
 * (sourceId, kennelId) so re-runs are idempotent. Errors are logged per row
 * rather than raised so a single bad slug can't abort the batch. SourceKennel
 * only — aliases are global and stay gated behind admin confirmation.
 */
async function createMissingLinks(
  prisma: PrismaClient,
  sourceId: string,
  picks: EligibleDiscovery[],
): Promise<{ created: number; errored: number }> {
  let created = 0;
  let errored = 0;
  for (const d of picks) {
    if (!d.matchedKennelId) continue;
    const kennelId = d.matchedKennelId;
    try {
      await prisma.sourceKennel.upsert({
        where: { sourceId_kennelId: { sourceId, kennelId } },
        update: { externalSlug: d.externalSlug },
        create: { sourceId, kennelId, externalSlug: d.externalSlug },
      });
      created++;
    } catch (err) {
      errored++;
      console.error(`  ✗ ${d.externalSlug}: ${err}`);
    }
  }
  return { created, errored };
}

/**
 * Orchestrator: resolve the HASHREGO source, load discoveries + existing
 * links, dedupe to one pick per kennel, log a sample, and (unless dry-run)
 * apply the writes.
 */
async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const source = await prisma.source.findFirst({
    where: { type: "HASHREGO" },
    select: { id: true, name: true },
  });
  if (!source) {
    console.error("No HASHREGO source found — nothing to backfill.");
    await pool.end();
    process.exit(1);
  }
  console.log(`HASHREGO source: ${source.name} (${source.id})`);

  const before = await prisma.sourceKennel.count({ where: { sourceId: source.id } });
  console.log(`SourceKennel rows (before): ${before}`);

  // Exclude DISMISSED: dismissDiscovery() only flips status but leaves
  // matchedKennelId populated, so a naive query would resurrect deliberately
  // rejected mappings. Also exclude NEW (a matchedKennelId on a NEW row is a
  // candidate suggestion, not an accepted link).
  const discoveries = await prisma.kennelDiscovery.findMany({
    where: {
      externalSource: "HASHREGO",
      matchedKennelId: { not: null },
      status: { in: ["MATCHED", "LINKED", "ADDED"] },
    },
    select: {
      externalSlug: true,
      matchedKennelId: true,
      status: true,
      lastSeenAt: true,
      processedAt: true,
    },
  });
  console.log(`Eligible HASHREGO discoveries (MATCHED/LINKED/ADDED): ${discoveries.length}`);

  const existingLinks = await prisma.sourceKennel.findMany({
    where: { sourceId: source.id },
    select: { kennelId: true },
  });
  const linkedKennelIds = new Set(existingLinks.map((l) => l.kennelId));

  const { picks, eligibleCount } = dedupeByKennel(discoveries, linkedKennelIds);
  const collapsed = eligibleCount - picks.length;
  console.log(`Missing SourceKennel rows: ${picks.length} (collapsed ${collapsed} duplicate discoveries)\n`);

  if (picks.length === 0) {
    console.log("Nothing to backfill.");
    await pool.end();
    return;
  }

  console.log("Sample (first 10):");
  for (const d of picks.slice(0, 10)) {
    console.log(`  ${d.externalSlug} → ${d.matchedKennelId} [${d.status}]`);
  }
  console.log();

  if (dryRun) {
    console.log(`Would create ${picks.length} SourceKennel rows. Re-run with --apply.`);
    await pool.end();
    return;
  }

  const { created, errored } = await createMissingLinks(prisma, source.id, picks);

  const after = await prisma.sourceKennel.count({ where: { sourceId: source.id } });
  console.log(`\nCreated: ${created}  Errored: ${errored}`);
  console.log(`SourceKennel rows (after): ${after} (+${after - before})`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
