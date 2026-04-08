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
import pg from "pg";

const dryRun = !process.argv.includes("--apply");

async function main() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
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

  // Dedupe to one canonical discovery per kennel. When multiple discoveries
  // point at the same matchedKennelId (e.g. a slug was renamed upstream),
  // pick the most authoritative: status priority (LINKED > ADDED > MATCHED),
  // then newest processedAt, then newest lastSeenAt.
  const statusPriority: Record<string, number> = { LINKED: 3, ADDED: 2, MATCHED: 1 };
  type D = (typeof discoveries)[number];
  const byKennel = new Map<string, D>();
  for (const d of discoveries) {
    const kid = d.matchedKennelId!;
    if (linkedKennelIds.has(kid)) continue;
    const cur = byKennel.get(kid);
    if (!cur) {
      byKennel.set(kid, d);
      continue;
    }
    const curScore = statusPriority[cur.status] ?? 0;
    const dScore = statusPriority[d.status] ?? 0;
    if (dScore !== curScore) {
      if (dScore > curScore) byKennel.set(kid, d);
      continue;
    }
    const curTime = (cur.processedAt ?? cur.lastSeenAt ?? new Date(0)).getTime();
    const dTime = (d.processedAt ?? d.lastSeenAt ?? new Date(0)).getTime();
    if (dTime > curTime) byKennel.set(kid, d);
  }
  const missing = [...byKennel.values()];
  const collapsed = discoveries.filter((d) => d.matchedKennelId && !linkedKennelIds.has(d.matchedKennelId)).length - missing.length;
  console.log(`Missing SourceKennel rows: ${missing.length} (collapsed ${collapsed} duplicate discoveries)\n`);

  if (missing.length === 0) {
    console.log("Nothing to backfill.");
    await pool.end();
    return;
  }

  // Show a sample
  console.log("Sample (first 10):");
  for (const d of missing.slice(0, 10)) {
    console.log(`  ${d.externalSlug} → ${d.matchedKennelId} [${d.status}]`);
  }
  console.log();

  if (dryRun) {
    console.log(`Would create ${missing.length} SourceKennel rows. Re-run with --apply.`);
    await pool.end();
    return;
  }

  // SourceKennel only — aliases are global and gated behind explicit admin
  // confirmation (confirmMatch / linkDiscoveryToKennel). A confirmed LINKED
  // discovery already had its alias created at confirm time; a legacy MATCHED
  // row should not retroactively create one.
  let created = 0;
  let errored = 0;
  for (const d of missing) {
    const kennelId = d.matchedKennelId!;
    try {
      await prisma.sourceKennel.upsert({
        where: { sourceId_kennelId: { sourceId: source.id, kennelId } },
        update: { externalSlug: d.externalSlug },
        create: { sourceId: source.id, kennelId, externalSlug: d.externalSlug },
      });
      created++;
    } catch (err) {
      errored++;
      console.error(`  ✗ ${d.externalSlug}: ${err}`);
    }
  }

  const after = await prisma.sourceKennel.count({ where: { sourceId: source.id } });
  console.log(`\nCreated: ${created}  Errored: ${errored}`);
  console.log(`SourceKennel rows (after): ${after} (+${after - before})`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
