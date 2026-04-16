/**
 * One-shot backfill: null out Event.sourceUrl where it points at the broken
 * hashruns.org Flutter UI. HARRIER_CENTRAL events used to emit
 * `https://www.hashruns.org/#/event/<uuid>` URLs; the API still serves the
 * UUIDs but the Flutter page no longer resolves them (#706, #725).
 *
 * The adapter has already been changed to stop emitting these URLs for new
 * events — this script clears the existing rows. Merge.ts preserves existing
 * sourceUrl ahead of new adapter output, so without this script the broken
 * URLs would persist for already-ingested events.
 *
 * Usage:
 *   npx tsx scripts/clear-hc-sourceurls.ts           # dry run (default)
 *   npx tsx scripts/clear-hc-sourceurls.ts --apply   # apply changes
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const affected = await prisma.event.findMany({
    where: { sourceUrl: { contains: "hashruns.org" } },
    select: { id: true, sourceUrl: true, kennel: { select: { shortName: true } } },
  });

  console.log(`Found ${affected.length} Event(s) with hashruns.org sourceUrl.`);
  if (affected.length === 0) {
    await pool.end();
    return;
  }

  for (const e of affected.slice(0, 10)) {
    console.log(`  ${e.id}  ${e.kennel.shortName}  ${e.sourceUrl}`);
  }
  if (affected.length > 10) console.log(`  … and ${affected.length - 10} more`);

  if (dryRun) {
    console.log("\n(dry run) re-run with --apply to null these URLs.");
    await pool.end();
    return;
  }

  const res = await prisma.event.updateMany({
    where: { sourceUrl: { contains: "hashruns.org" } },
    data: { sourceUrl: null },
  });
  console.log(`\n✅ Nulled sourceUrl on ${res.count} Event(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
