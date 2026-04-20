/**
 * One-shot fix for #817: the 3 HARRIER_CENTRAL sources (Tokyo H3, Morgantown
 * H3, Singapore Sunday H3) were collapsed into a single Source row by the
 * `(url, type)` branch of the seed's findFirst at prisma/seed.ts:363-371. All
 * 3 share the identical base API URL, so each subsequent seed run overwrote
 * the previous row's name + config. The surviving row depends on seed order;
 * the issue observed it as "Singapore Sunday H3 Harrier Central".
 *
 * The seed fix (restrict identity to `(name, type)`) prevents recurrence but
 * cannot heal the already-merged prod row. This script does the data repair:
 *
 *   1. Find every Source with type=HARRIER_CENTRAL.
 *   2. For each seed entry NOT yet represented in the DB, create the missing
 *      row (copying name, url, config, etc. from the seed definition).
 *   3. Re-parent SourceKennel rows: `tokyo-h3` → Tokyo source,
 *      `mh3-wv` → Morgantown source, `sh3-sg` → Singapore source.
 *   4. Leave existing RawEvents on the surviving row untouched — they were
 *      scraped while the config was SH3-SG, so they belong with the SG source.
 *      Tokyo + Morgantown will pick up fresh RawEvents on the next scrape.
 *
 * Usage:
 *   npx tsx scripts/split-harrier-central-sources.ts           # dry run
 *   npx tsx scripts/split-harrier-central-sources.ts --apply   # apply
 *
 * Load env first (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { SOURCES } from "@/../prisma/seed-data/sources";

const dryRun = !process.argv.includes("--apply");

type SeedSource = (typeof SOURCES)[number];

interface PlannedCreate {
  name: string;
  kennelCodes: readonly string[];
  seed: SeedSource;
}

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const hcSeeds = SOURCES.filter((s) => s.type === "HARRIER_CENTRAL");
  console.log(`Found ${hcSeeds.length} HARRIER_CENTRAL source(s) in seed data:`);
  for (const s of hcSeeds) console.log(`  • ${s.name}`);
  console.log();

  const hcRows = await prisma.source.findMany({
    where: { type: "HARRIER_CENTRAL" },
    select: { id: true, name: true, url: true, config: true },
  });
  console.log(`Found ${hcRows.length} HARRIER_CENTRAL Source row(s) in DB:`);
  for (const r of hcRows) console.log(`  • ${r.id}  ${r.name}`);
  console.log();

  const byName = new Map(hcRows.map((r) => [r.name, r]));
  const toCreate: PlannedCreate[] = [];
  for (const seed of hcSeeds) {
    if (byName.has(seed.name)) continue;
    toCreate.push({ name: seed.name, kennelCodes: seed.kennelCodes, seed });
  }

  if (toCreate.length === 0 && hcRows.length === hcSeeds.length) {
    console.log("✅ DB already in the correct shape — nothing to do.");
    await pool.end();
    return;
  }

  console.log(`Plan: create ${toCreate.length} missing Source row(s)\n`);
  for (const c of toCreate) {
    console.log(`  + Create Source: ${c.name}`);
    console.log(`      kennelCodes to re-parent: ${c.kennelCodes.join(", ")}`);
  }
  console.log();

  // Look up kennels we'll need to re-link.
  const allCodes = Array.from(new Set(toCreate.flatMap((c) => c.kennelCodes)));
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: allCodes } },
    select: { id: true, kennelCode: true, shortName: true },
  });
  const kennelsByCode = new Map(kennels.map((k) => [k.kennelCode, k]));
  const missingCodes = allCodes.filter((c) => !kennelsByCode.has(c));
  if (missingCodes.length > 0) {
    console.error(`❌ Missing kennels in DB for kennelCodes: ${missingCodes.join(", ")}`);
    console.error("   Seed kennels first, then re-run this script.");
    await pool.end();
    process.exit(1);
  }

  if (dryRun) {
    console.log("(dry run) re-run with --apply to create sources + re-link SourceKennel rows.");
    await pool.end();
    return;
  }

  for (const c of toCreate) {
    const { kennelCodes: _kc, kennelSlugMap: _ksm, ...data } = c.seed as unknown as Record<string, unknown>;
    const newSource = await prisma.source.create({ data: data as never });
    console.log(`  ✓ Created Source ${newSource.id}  ${newSource.name}`);

    for (const code of c.kennelCodes) {
      const kennel = kennelsByCode.get(code)!;
      const existingLinks = await prisma.sourceKennel.findMany({
        where: { kennelId: kennel.id, source: { type: "HARRIER_CENTRAL" } },
      });
      const toNew = existingLinks.find((l) => l.sourceId !== newSource.id);
      if (toNew) {
        // Re-parent the existing link. Use upsert via delete+create because
        // @@unique([sourceId, kennelId]) could collide with an existing
        // link to the new source.
        const alreadyLinked = await prisma.sourceKennel.findUnique({
          where: { sourceId_kennelId: { sourceId: newSource.id, kennelId: kennel.id } },
        });
        if (alreadyLinked) {
          await prisma.sourceKennel.delete({ where: { id: toNew.id } });
          console.log(`    ~ Dropped dup SourceKennel for ${code} (kept ${alreadyLinked.id})`);
        } else {
          await prisma.sourceKennel.update({
            where: { id: toNew.id },
            data: { sourceId: newSource.id },
          });
          console.log(`    → Re-parented SourceKennel for ${code} → ${newSource.id}`);
        }
      } else {
        await prisma.sourceKennel.create({
          data: { sourceId: newSource.id, kennelId: kennel.id },
        });
        console.log(`    + Created SourceKennel for ${code} → ${newSource.id}`);
      }
    }
  }

  console.log("\n✅ Done. Trigger a fresh scrape of each HC source to repopulate RawEvents.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
