/**
 * #1406 cleanup — rewrite historical HSWTF (hswtf-h3) canonical titles that
 * still carry the bare kennel-code placeholder "HSWTFH3…". These ~102 events
 * (2013–2017) predate the WA Hash calendar's scrape window, so they will never
 * re-scrape; the forward fix (defaultTitles + staleTitleAliases on the source)
 * only helps future/in-window events.
 *
 * Rewrites by shape, deriving a real title where the source encoded one:
 *   "HSWTFH3 #99 (99 problems…)"  → "99 problems…"            (theme in parens)
 *   "HSWTFH3 #153"                → "HSWTF Trail #153"
 *   "HSWTFH3# 62"                 → "HSWTF Trail #62"
 *   "HSWTFH3 <free text>"         → "<free text>"
 *   "HSWTFH3" / "HSWTFH3 #?"      → "HSWTF Trail"
 *
 * Dry-run by default:
 *   set -a && source .env && set +a && npx tsx scripts/cleanup-hswtf-placeholder-titles.ts
 * Apply: append ` -- --apply`.
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const APPLY = process.argv.includes("--apply");
const DEFAULT_TITLE = "HSWTF Trail";

interface Rewrite { title: string; runNumber?: number }

function rewriteTitle(raw: string): Rewrite | null {
  const t = raw.trim();
  if (!t.startsWith("HSWTFH3")) return null;
  // Strip the kennel-code prefix and work on the remainder with anchored
  // regexes that use bounded char classes (no `(.+)` / doubled `\s+` — those
  // shapes trip Sonar's ReDoS hotspot, S5852).
  const rest = t.slice("HSWTFH3".length).trim();
  // "#N (theme)" — theme wins as the title; keep the run number.
  let m = /^#\s*(\d+)\s*\(([^)]+)\)$/.exec(rest);
  if (m) return { title: m[2].trim(), runNumber: Number.parseInt(m[1], 10) };
  // "#N" (optionally a space after #) → "HSWTF Trail #N"
  m = /^#\s*(\d+)$/.exec(rest);
  if (m) return { title: `${DEFAULT_TITLE} #${m[1]}`, runNumber: Number.parseInt(m[1], 10) };
  // empty remainder or unknown-run placeholder ("#?", "#??") → generic default
  if (rest === "" || /^#\s*\?+$/.test(rest)) return { title: DEFAULT_TITLE };
  // free text not starting with "#" → use it verbatim as the title
  if (!rest.startsWith("#")) return { title: rest };
  return null; // leave anything unrecognized untouched
}

async function main() {
  const events = await prisma.event.findMany({
    where: { eventKennels: { some: { kennel: { kennelCode: "hswtf-h3" } } }, title: { contains: "HSWTFH3" } },
    select: { id: true, date: true, title: true, runNumber: true },
    orderBy: { date: "asc" },
  });
  console.log(`HSWTF events with 'HSWTFH3' in title: ${events.length}`);
  let planned = 0, skipped = 0;
  for (const e of events) {
    const rw = rewriteTitle(e.title ?? "");
    if (!rw || rw.title === e.title) { skipped++; continue; }
    planned++;
    const runNote = rw.runNumber && rw.runNumber !== e.runNumber ? ` run ${e.runNumber}→${rw.runNumber}` : "";
    console.log(`  ${e.date.toISOString().slice(0, 10)} ${JSON.stringify(e.title)} → ${JSON.stringify(rw.title)}${runNote}`);
    if (APPLY) {
      await prisma.event.update({
        where: { id: e.id },
        data: { title: rw.title, ...(rw.runNumber && e.runNumber == null ? { runNumber: rw.runNumber } : {}) },
      });
    }
  }
  console.log(`\n${APPLY ? "Applied" : "Planned"}: ${planned}; unchanged: ${skipped}`);
  if (!APPLY) console.log("Dry run — re-run with ` -- --apply` to write the above.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
