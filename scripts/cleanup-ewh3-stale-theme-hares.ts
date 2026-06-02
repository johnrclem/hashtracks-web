/**
 * #1892 cleanup — null EWH3 canonical `haresText` that is actually the run
 * THEME, not hares. The pre-#1227 Google Calendar adapter routed the pre-dash
 * summary text ("Autism Speaks for Deities & Friends! - Dupont Circle") into
 * haresText; the current adapter no longer does (no titleHarePattern for EWH3),
 * but the merge pipeline preserves the stale value (undefined = keep).
 *
 * Precise + safe: only clears rows where `haresText` EQUALS the title or the
 * title's pre-dash prefix (the theme). Legit hares supplied by sibling sources
 * (Hash Rego / WordPress — "PSA & Haystack", "PhD and Tatas") differ from the
 * title and are left untouched.
 *
 * Run AFTER the seed config + re-scrape have deployed (so a cron scrape in the
 * gap doesn't re-add it). Dry-run by default:
 *   set -a && source .env && set +a && npx tsx scripts/cleanup-ewh3-stale-theme-hares.ts
 * Apply: append ` -- --apply`.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");

function isThemeHares(title: string | null, hares: string): boolean {
  if (!title) return false;
  const t = title.trim();
  const h = hares.trim();
  if (t === h) return true;
  // pre-dash prefix (string op, not regex — avoids a Sonar ReDoS flag)
  const dash = t.indexOf(" - ");
  return dash !== -1 && t.slice(0, dash).trim() === h;
}

async function main() {
  const events = await prisma.event.findMany({
    where: { eventKennels: { some: { kennel: { kennelCode: "ewh3" } } }, haresText: { not: null } },
    select: { id: true, date: true, title: true, haresText: true },
    orderBy: { date: "desc" },
  });
  const targets = events.filter((e) => e.haresText && isThemeHares(e.title, e.haresText));
  console.log(`EWH3 events with haresText: ${events.length}; theme-as-hares to clear: ${targets.length}`);
  for (const e of targets) {
    console.log(`  ${e.date.toISOString().slice(0, 10)} title=${JSON.stringify(e.title)} hares=${JSON.stringify(e.haresText)}`);
  }
  if (!APPLY) {
    console.log("\nDry run — re-run with ` -- --apply` to clear haresText on the above.");
    return;
  }
  let cleared = 0;
  for (const e of targets) {
    await prisma.event.update({ where: { id: e.id }, data: { haresText: null } });
    cleared++;
  }
  console.log(`\nCleared haresText on ${cleared} EWH3 events.`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
