/**
 * #1891 follow-up cleanup — strip the stale "BH3:" title prefix from historical
 * Boston H3 (boh3) canonical events. The forward fix (titleStripPatterns
 * `^BH3:\s*` on the Boston Hash Calendar source, PR #1909) cleans new/in-window
 * events on scrape, but ~124 past events (2017–early 2026) have aged off the
 * Google Calendar window and will never re-scrape, so they keep the prefix.
 *
 * Pure prefix strip — safe to run after the forward fix is deployed (the
 * adapter no longer emits "BH3:"-prefixed titles, so this won't be re-added).
 *
 * Dry-run by default:
 *   set -a && source .env && set +a && npx tsx scripts/cleanup-boston-bh3-prefix-titles.ts
 * Apply: append ` -- --apply`.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");

/**
 * Return the title with a leading "BH3:" stripped, or null when there is
 * nothing to change (no prefix, or the strip would leave the title identical /
 * empty).
 */
function stripPrefix(title: string): string | null {
  if (!title.startsWith("BH3:")) return null;
  const stripped = title.slice("BH3:".length).trim();
  return stripped && stripped !== title ? stripped : null;
}

/**
 * Find Boston (boh3) canonical events whose title still carries the "BH3:"
 * prefix, log each planned rewrite, and (with --apply) persist the stripped
 * titles. Dry-run by default.
 */
async function main() {
  const events = await prisma.event.findMany({
    where: { eventKennels: { some: { kennel: { kennelCode: "boh3" } } }, title: { startsWith: "BH3:" } },
    select: { id: true, date: true, title: true },
    orderBy: { date: "asc" },
  });
  console.log(`Boston events with a 'BH3:' title prefix: ${events.length}`);
  let planned = 0;
  for (const e of events) {
    const stripped = stripPrefix(e.title ?? "");
    if (!stripped) continue;
    planned++;
    console.log(`  ${e.date.toISOString().slice(0, 10)} ${JSON.stringify(e.title)} → ${JSON.stringify(stripped)}`);
    if (APPLY) await prisma.event.update({ where: { id: e.id }, data: { title: stripped } });
  }
  console.log(`\n${APPLY ? "Applied" : "Planned"}: ${planned}`);
  if (!APPLY) console.log("Dry run — re-run with ` -- --apply` to write the above.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
