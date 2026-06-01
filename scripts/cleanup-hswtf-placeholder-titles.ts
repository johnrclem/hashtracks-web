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
  // #N (theme) — theme wins as the title; keep the run number.
  let m = /^HSWTFH3\s*#\s*(\d+)\s*\((.+)\)\s*$/.exec(t);
  if (m) return { title: m[2].trim(), runNumber: Number.parseInt(m[1], 10) };
  // bare #N (optionally with a space-before-or-after #) → "HSWTF Trail #N"
  m = /^HSWTFH3\s*#?\s*(\d+)\s*$/.exec(t);
  if (m) return { title: `${DEFAULT_TITLE} #${m[1]}`, runNumber: Number.parseInt(m[1], 10) };
  // bare code or unknown-run placeholder → generic default
  if (/^HSWTFH3\s*(?:#\s*\?+)?\s*$/.test(t)) return { title: DEFAULT_TITLE };
  // "HSWTFH3 <free text>" (no leading #) → use the free text as the title
  m = /^HSWTFH3\s+(?!#)(\S.*)$/.exec(t);
  if (m) return { title: m[1].trim() };
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
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
