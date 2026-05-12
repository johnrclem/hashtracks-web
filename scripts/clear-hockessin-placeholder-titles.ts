/**
 * One-shot cleanup for #1326: the Hockessin H3 adapter previously emitted
 * `title = \`Hockessin H3 Trail #${runNumber}\`` for every event, even though
 * the source format `Hash #N: <hares>` provides no source-distinct title.
 * The adapter fix in this PR emits `title: undefined` going forward, but the
 * merge pipeline treats `undefined` as "preserve existing" — so the 5 stale
 * Event rows already in prod will keep their synthesized titles unless we
 * clear them in-place.
 *
 * This script clears `title` on Event rows that match the exact placeholder
 * shape, scoped to the Hockessin kennel.
 *
 * Runs in dry-run mode by default — pass `--apply` to write.
 *   npm run tsx scripts/clear-hockessin-placeholder-titles.ts           # preview
 *   npm run tsx scripts/clear-hockessin-placeholder-titles.ts -- --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");
const PLACEHOLDER_RE = /^Hockessin H3 Trail #\d+$/;

async function main() {
  const kennel = await prisma.kennel.findFirst({ where: { kennelCode: "hockessin" } });
  if (!kennel) {
    console.error("Hockessin kennel not found — aborting.");
    process.exit(1);
  }

  interface Row { id: string; title: string | null; runNumber: number | null }
  const events: Row[] = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true, runNumber: true },
  });

  const matches = events.filter((e: Row): e is Row & { title: string } => e.title !== null && PLACEHOLDER_RE.test(e.title));
  console.log(`Found ${matches.length} Hockessin Event rows with placeholder title.`);
  for (const e of matches) {
    console.log(`  CLEAR  ${e.id}  runNumber=${e.runNumber}  title="${e.title}"`);
  }

  if (APPLY && matches.length > 0) {
    const result = await prisma.event.updateMany({
      where: { id: { in: matches.map((e) => e.id) } },
      data: { title: null },
    });
    console.log(`\nCleared ${result.count} titles.`);
  } else if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
