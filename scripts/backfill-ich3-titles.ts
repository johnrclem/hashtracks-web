/**
 * One-time backfill: fix ICH3 events whose title leaked the
 * `ICH3# {N} {HareName}` SUMMARY shape (#2160). The adapter now strips this
 * forward, but the merge pipeline preserves a non-placeholder existing title
 * (`resolveUpdatedTitle` keeps `ICH3# 60 Plea Barkin` because it isn't a
 * themeless placeholder), so already-ingested rows — the #1339 historical
 * backfill plus any pre-fix live runs — need this one-shot.
 *
 * For each matched row:
 *   - move the hare name into `haresText` when that field is empty (never
 *     clobber a real value), and
 *   - rewrite the title to the canonical merge default
 *     `<displayName> Trail #N` so the hare no longer doubles as the title.
 *
 * Conservative match: only the `ICH3[# ]*N HareName` shape is touched. A real
 * themed ICH3 title (if one ever exists) has no run-marker prefix and is left
 * untouched.
 *
 * Usage:
 *   npx tsx scripts/backfill-ich3-titles.ts          # dry run (default)
 *   npx tsx scripts/backfill-ich3-titles.ts --apply  # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { friendlyKennelName } from "../src/pipeline/merge";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

// Single char class `[#\s]*` (no adjacent `\s*` around an optional literal) so
// the analyzer sees a provably linear pattern. Matches "ICH3# 60 Plea Barkin"
// and "ICH3 #60 Plea Barkin"; requires a real run number + a non-empty hare.
const ICH3_LEAKED_TITLE_RE = /^ICH3[#\s]*(\d+)\s+(.+)$/i;

/** Parse a leaked ICH3 title into `{ runNumber, hares }`, or null when it isn't the leaked shape. */
export function parseIch3LeakedTitle(title: string): { runNumber: number; hares: string } | null {
  const m = ICH3_LEAKED_TITLE_RE.exec(title.trim());
  if (!m) return null;
  const runNumber = Number.parseInt(m[1], 10);
  const hares = m[2].trim();
  if (!Number.isFinite(runNumber) || runNumber <= 0 || !hares) return null;
  return { runNumber, hares };
}

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: "ich3" },
    select: { id: true, kennelCode: true, shortName: true, fullName: true },
  });
  if (!kennel) {
    console.error("ICH3 kennel not found — nothing to do.");
    await prisma.$disconnect();
    pool.end();
    return;
  }

  const displayName = friendlyKennelName(kennel.shortName, kennel.fullName) || kennel.kennelCode;

  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true, haresText: true },
  });

  const updates: { id: string; oldTitle: string; newTitle: string; setHares: string | null }[] = [];
  for (const ev of events) {
    if (!ev.title) continue;
    const parsed = parseIch3LeakedTitle(ev.title);
    if (!parsed) continue;
    const newTitle = `${displayName} Trail #${parsed.runNumber}`;
    if (newTitle === ev.title) continue;
    // Only seed haresText when it's currently empty — never overwrite a value
    // a misman or richer source already supplied.
    const setHares = ev.haresText?.trim() ? null : parsed.hares;
    updates.push({ id: ev.id, oldTitle: ev.title, newTitle, setHares });
  }

  console.log(`ICH3 (${kennel.shortName}): ${updates.length} event(s) to fix`);
  for (const u of updates.slice(0, 10)) {
    console.log(`  ${u.id}: "${u.oldTitle}" → "${u.newTitle}"${u.setHares ? ` | hares="${u.setHares}"` : ""}`);
  }
  if (updates.length > 10) console.log(`  ... and ${updates.length - 10} more`);

  if (!dryRun) {
    for (const u of updates) {
      await prisma.event.update({
        where: { id: u.id },
        data: { title: u.newTitle, ...(u.setHares ? { haresText: u.setHares } : {}) },
      });
    }
  }

  console.log(`\n${dryRun ? "Would fix" : "Fixed"} ${updates.length} ICH3 title(s).`);
  if (dryRun && updates.length > 0) console.log("Run with --apply to make changes.");

  await prisma.$disconnect();
  pool.end();
}

// Only run when invoked directly (not when imported by tests).
const isEntrypoint =
  typeof process !== "undefined" &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isEntrypoint) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
