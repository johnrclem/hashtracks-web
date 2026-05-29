/**
 * #1757 / #1758 — repair NbH3 canonical rows the pre-fix scraper mis-stored.
 * Before the section-year anchor, ANCIENT HASHTORY 2025 trails (#225–#234)
 * were chrono-parsed into 2026, a duplicate #225 landed, and the zero-width
 * "​2025" section heading leaked into `locationName`.
 *
 * This re-dates the mis-yeared rows to 2025 (same month/day), clears the
 * "2025" location leak, and de-duplicates rows that collide on
 * (runNumber, date) after the shift. Idempotent with the post-deploy
 * re-scrape (which matches the corrected rows by runNumber + sourceUrl).
 *
 * Dry-run by default. Pass --apply to write. Targets the prod DB.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

// Run numbers that live under the ANCIENT HASHTORY "2025" heading.
const Y2025_RUNS = new Set([225, 226, 227, 228, 229, 230, 231, 232, 233, 234]);

const stripZeroWidth = (s: string) => s.replace(/[\u200B-\u200F\uFEFF]/g, "");
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const host = new URL(process.env.DATABASE_URL ?? "").host;
  console.log(`DB: ${host} | mode: ${APPLY ? "APPLY" : "DRY-RUN"}`);

  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "nbh3" } });
  if (!kennel) throw new Error("nbh3 kennel not found");

  const rows = await prisma.event.findMany({
    where: { kennelId: kennel.id },
    select: { id: true, date: true, runNumber: true, title: true, locationName: true, createdAt: true },
    orderBy: [{ runNumber: "asc" }, { createdAt: "asc" }],
  });

  // 1. Compute the corrected date + cleared location per row.
  type Plan = { id: string; runNumber: number | null; oldDate: Date; newDate: Date; clearLoc: boolean; title: string | null };
  const plans: Plan[] = [];
  for (const e of rows) {
    const year = e.date.getUTCFullYear();
    let newDate = e.date;
    if (e.runNumber != null && Y2025_RUNS.has(e.runNumber) && year === 2026) {
      newDate = new Date(Date.UTC(2025, e.date.getUTCMonth(), e.date.getUTCDate(), 12, 0, 0));
    }
    const clearLoc = !!e.locationName && stripZeroWidth(e.locationName).trim() === "2025";
    if (newDate.getTime() !== e.date.getTime() || clearLoc) {
      plans.push({ id: e.id, runNumber: e.runNumber, oldDate: e.date, newDate, clearLoc, title: e.title });
    }
  }

  // 2. De-dup: after the shift, collapse rows sharing (runNumber, newDate),
  //    keeping the earliest-created (first in the sorted list).
  const seen = new Set<string>();
  const deletes: string[] = [];
  for (const p of plans) {
    if (p.runNumber == null) continue;
    const key = `${p.runNumber}|${iso(p.newDate)}`;
    if (seen.has(key)) deletes.push(p.id);
    else seen.add(key);
  }
  const deleteSet = new Set(deletes);

  console.log(`\n${plans.length} rows to update, ${deletes.length} duplicate(s) to delete:\n`);
  for (const p of plans) {
    const tag = deleteSet.has(p.id) ? "DELETE (dup)" : "UPDATE";
    console.log(`  ${tag} #${p.runNumber ?? "—"} ${iso(p.oldDate)} → ${iso(p.newDate)}${p.clearLoc ? " [clear loc]" : ""} | ${p.title}`);
  }

  if (APPLY) {
    for (const p of plans) {
      if (deleteSet.has(p.id)) {
        await prisma.event.delete({ where: { id: p.id } });
        continue;
      }
      await prisma.event.update({
        where: { id: p.id },
        data: {
          ...(p.newDate.getTime() !== p.oldDate.getTime() ? { date: p.newDate } : {}),
          ...(p.clearLoc ? { locationName: null } : {}),
        },
      });
    }
  }
  console.log(`\n${APPLY ? "Done" : "Dry-run complete"}.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
