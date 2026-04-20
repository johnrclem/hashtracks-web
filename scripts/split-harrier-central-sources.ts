/**
 * One-shot prod repair for #817: splits a Source row that collapsed multiple
 * HARRIER_CENTRAL seed entries into one (via the old `(url, type)` seed
 * identity) back into one row per seed entry, and re-parents SourceKennel
 * links. Leaves existing RawEvents on the surviving row — next scrape
 * repopulates the new rows.
 *
 * Convergent across partial failures: the plan is driven by missing
 * `(Source, SourceKennel)` pairs, not just missing Source rows, and each
 * per-source apply runs in a transaction. Safe to rerun after any crash.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   npx tsx scripts/split-harrier-central-sources.ts            # dry run
 *   npx tsx scripts/split-harrier-central-sources.ts --apply    # apply
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { SOURCES } from "@/../prisma/seed-data/sources";

const dryRun = !process.argv.includes("--apply");

type SeedSource = (typeof SOURCES)[number];

interface PlannedSource {
  seed: SeedSource;
  /** Existing Source row (if the previous apply partially succeeded), else null. */
  existing: { id: string; name: string } | null;
  /** kennelCodes from the seed that still need SourceKennel links to this source. */
  missingKennelCodes: string[];
}

interface OrphanLink {
  sourceId: string;
  sourceName: string;
  kennelId: string;
  kennelCode: string;
}

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  try {
    console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

    const hcSeeds = SOURCES.filter((s) => s.type === "HARRIER_CENTRAL");
    console.log(`Found ${hcSeeds.length} HARRIER_CENTRAL source(s) in seed data:`);
    for (const s of hcSeeds) console.log(`  • ${s.name}`);
    console.log();

    const hcRows = await prisma.source.findMany({
      where: { type: "HARRIER_CENTRAL" },
      select: { id: true, name: true },
    });
    console.log(`Found ${hcRows.length} HARRIER_CENTRAL Source row(s) in DB:`);
    for (const r of hcRows) console.log(`  • ${r.id}  ${r.name}`);
    console.log();

    const byName = new Map(hcRows.map((r) => [r.name, r]));

    // Preload all kennels referenced by HC seeds, plus all SourceKennel rows on
    // HC sources — drives the plan + idempotency check with O(1) lookups.
    const allCodes = Array.from(new Set(hcSeeds.flatMap((s) => s.kennelCodes)));
    const kennels = await prisma.kennel.findMany({
      where: { kennelCode: { in: allCodes } },
      select: { id: true, kennelCode: true },
    });
    const kennelsByCode = new Map(kennels.map((k) => [k.kennelCode, k]));
    const missingKennelRecords = allCodes.filter((c) => !kennelsByCode.has(c));
    if (missingKennelRecords.length > 0) {
      console.error(`❌ Missing kennels in DB for kennelCodes: ${missingKennelRecords.join(", ")}`);
      console.error("   Seed kennels first, then re-run this script.");
      process.exit(1);
    }

    const existingLinks = await prisma.sourceKennel.findMany({
      where: { source: { type: "HARRIER_CENTRAL" } },
      select: { sourceId: true, kennelId: true },
    });
    const linkKey = (sourceId: string, kennelId: string) => `${sourceId}:${kennelId}`;
    const existingLinkSet = new Set(existingLinks.map((l) => linkKey(l.sourceId, l.kennelId)));

    // Plan: for each seed, what's missing? A seed is done iff its Source row
    // exists AND all its kennelCodes are linked to it.
    const plan: PlannedSource[] = hcSeeds.map((seed) => {
      const existing = byName.get(seed.name) ?? null;
      const missingKennelCodes = existing
        ? seed.kennelCodes.filter((code) => {
            const kennel = kennelsByCode.get(code)!;
            return !existingLinkSet.has(linkKey(existing.id, kennel.id));
          })
        : [...seed.kennelCodes];
      return { seed, existing, missingKennelCodes };
    });

    // Orphan links = SourceKennel rows on an existing HC source that link to
    // a kennel NOT in that source's seed kennelCodes. These are residue from
    // the collapse and must be removed so the collapsed source no longer
    // claims ownership over kennels that now belong to a new source row.
    const seedByName = new Map(hcSeeds.map((s) => [s.name, s]));
    const kennelIdToCode = new Map(kennels.map((k) => [k.id, k.kennelCode]));
    const orphans: OrphanLink[] = [];
    for (const link of existingLinks) {
      const row = hcRows.find((r) => r.id === link.sourceId);
      if (!row) continue;
      const seed = seedByName.get(row.name);
      const kennelCode = kennelIdToCode.get(link.kennelId);
      if (!seed || !kennelCode) continue;
      if (!seed.kennelCodes.includes(kennelCode)) {
        orphans.push({ sourceId: link.sourceId, sourceName: row.name, kennelId: link.kennelId, kennelCode });
      }
    }

    const workItems = plan.filter((p) => !p.existing || p.missingKennelCodes.length > 0);
    if (workItems.length === 0 && orphans.length === 0) {
      console.log("✅ DB already in the correct shape — nothing to do.");
      return;
    }

    console.log(`Plan:\n`);
    for (const p of workItems) {
      if (!p.existing) {
        console.log(`  + Create Source: ${p.seed.name}`);
        console.log(`      Link kennels: ${p.missingKennelCodes.join(", ")}`);
      } else {
        console.log(`  ~ Source ${p.seed.name} exists (${p.existing.id}) — add missing links`);
        console.log(`      Link kennels: ${p.missingKennelCodes.join(", ")}`);
      }
    }
    for (const o of orphans) {
      console.log(`  - Delete orphan SourceKennel: ${o.sourceName} ⇢ ${o.kennelCode}`);
    }
    console.log();

    if (dryRun) {
      console.log("(dry run) re-run with --apply to execute.");
      return;
    }

    await prisma.$transaction(async (tx) => {
      for (const p of workItems) {
        let sourceId: string;
        if (p.existing) {
          sourceId = p.existing.id;
        } else {
          const seed = p.seed as SeedSource & { kennelSlugMap?: Record<string, string> };
          const { kennelCodes: _kc, kennelSlugMap: _ksm, ...data } = seed;
          const created = await tx.source.create({ data });
          sourceId = created.id;
          console.log(`  ✓ Created Source ${created.id}  ${created.name}`);
        }

        for (const code of p.missingKennelCodes) {
          const kennel = kennelsByCode.get(code)!;
          await tx.sourceKennel.upsert({
            where: { sourceId_kennelId: { sourceId, kennelId: kennel.id } },
            create: { sourceId, kennelId: kennel.id },
            update: {},
          });
          console.log(`    + Linked ${code} → ${sourceId}`);
        }
      }

      for (const o of orphans) {
        await tx.sourceKennel.delete({
          where: { sourceId_kennelId: { sourceId: o.sourceId, kennelId: o.kennelId } },
        });
        console.log(`    - Deleted orphan ${o.sourceName} ⇢ ${o.kennelCode}`);
      }
    });

    console.log("\n✅ Done. Trigger a fresh scrape of each HC source to repopulate RawEvents.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
