/**
 * One-time backfill: rewrite default event titles that use raw kennelTag/kennelCode
 * instead of the kennel's display name.
 *
 * Usage:
 *   npx tsx scripts/backfill-event-titles.ts          # dry run (default)
 *   npx tsx scripts/backfill-event-titles.ts --apply   # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { friendlyKennelName } from "../src/pipeline/merge";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const kennels = await prisma.kennel.findMany({
    select: {
      id: true,
      kennelCode: true,
      shortName: true,
      fullName: true,
      aliases: { select: { alias: true } },
    },
  });

  let totalRewritten = 0;

  for (const k of kennels) {
    const friendly = friendlyKennelName(k.shortName, k.fullName);

    // Collect all identifiers that could have been used as a default title prefix
    const identifiers = new Set<string>();
    identifiers.add(k.kennelCode);
    identifiers.add(k.shortName.toLowerCase());
    for (const a of k.aliases) {
      identifiers.add(a.alias.toLowerCase());
    }

    for (const id of identifiers) {
      // Skip if the identifier already produces the correct title
      if (id === friendly) continue;

      // Find events with bad default titles matching this identifier
      const badEvents = await prisma.event.findMany({
        where: {
          kennelId: k.id,
          OR: [
            { title: `${id} Trail` },
            { title: { startsWith: `${id} Trail #` } },
          ],
        },
        select: { id: true, title: true, runNumber: true },
      });

      if (badEvents.length === 0) continue;

      for (const ev of badEvents) {
        const newTitle = ev.runNumber
          ? `${friendly} Trail #${ev.runNumber}`
          : `${friendly} Trail`;

        if (dryRun) {
          console.log(`  [dry] ${k.shortName}: "${ev.title}" → "${newTitle}"`);
        } else {
          await prisma.event.update({
            where: { id: ev.id },
            data: { title: newTitle },
          });
        }
      }

      console.log(`  ${k.shortName}: ${badEvents.length} events (was: "${id} Trail...")`);
      totalRewritten += badEvents.length;
    }
  }

  console.log(`\n${dryRun ? "Would rewrite" : "Rewrote"} ${totalRewritten} events total.`);
  if (dryRun && totalRewritten > 0) {
    console.log("Run with --apply to make changes.");
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
