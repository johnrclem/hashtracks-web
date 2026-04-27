/**
 * One-time backfill for #1058 fallout: Chiang Mai HHH events whose title was
 * incorrectly set to the hare name. The adapter no longer emits `title`, but
 * the merge update path preserves existing values, so already-persisted bad
 * titles need to be rewritten by hand.
 *
 * Heuristic: kennel ∈ Chiang Mai 5 AND title === haresText.
 *
 * Usage:
 *   npx tsx scripts/backfill-chiangmai-titles.ts          # dry run (default)
 *   npx tsx scripts/backfill-chiangmai-titles.ts --apply   # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { friendlyKennelName } from "../src/pipeline/merge";
import { createScriptPool } from "./lib/db-pool";

const CHIANG_MAI_KENNEL_CODES = ["ch3-cm", "ch4-cm", "cgh3", "csh3", "cbh3-cm"];
const dryRun = !process.argv.includes("--apply");

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: CHIANG_MAI_KENNEL_CODES } },
    select: { id: true, kennelCode: true, shortName: true, fullName: true },
  });

  let totalRewritten = 0;

  for (const k of kennels) {
    const display = friendlyKennelName(k.shortName, k.fullName);

    const events = await prisma.event.findMany({
      where: {
        kennelId: k.id,
        title: { not: null },
        haresText: { not: null },
      },
      select: { id: true, title: true, haresText: true, runNumber: true },
    });

    const stale = events.filter((e) => e.title !== null && e.title === e.haresText);
    if (stale.length === 0) {
      console.log(`${k.kennelCode}: nothing to do (${events.length} events checked)`);
      continue;
    }

    console.log(`\n${k.kennelCode} (${display}): ${stale.length} event(s) to rewrite`);
    for (const e of stale) {
      const next = e.runNumber ? `${display} Trail #${e.runNumber}` : `${display} Trail`;
      console.log(`  ${e.id}: "${e.title}" → "${next}"`);
      if (!dryRun) {
        await prisma.event.update({ where: { id: e.id }, data: { title: next } });
      }
      totalRewritten++;
    }
  }

  console.log(`\n${dryRun ? "Would rewrite" : "Rewrote"} ${totalRewritten} event title(s).`);
  if (dryRun) console.log("Run with --apply to commit changes.");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
