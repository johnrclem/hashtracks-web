/**
 * One-time backfill: strip the redundant `ICH3# {N}` kennel+run prefix that
 * leaked into ICH3 event titles (#2160). The adapter now strips this forward
 * via `titleStripPrefixAliases`, but the merge pipeline preserves a
 * non-placeholder existing title, so already-ingested rows (the #1339
 * historical backfill plus pre-fix live runs) keep the prefix.
 *
 * IMPORTANT — title only, never hares. The real ICH3 archive shows the SUMMARY
 * remainder is usually a THEME ("Dancin' the Night Away", "IFT & the magic 8
 * ball from hell"), sometimes a hare name. An earlier version of this script
 * moved the remainder into `haresText`; that would corrupt the majority theme
 * case, so we only strip the prefix and keep the remainder as the title —
 * exactly what the live adapter now does (reusing `stripTitleKennelRunPrefix`
 * keeps the two in lockstep).
 *
 * Conservative match: only titles that actually start with the `ICH3[# ]*N`
 * prefix are touched. Emoji-decorated titles ("☠️ ICH3 #57: …") and the
 * `IC-Lite#NN` sub-series match nothing and are left untouched.
 *
 * Usage:
 *   npx tsx scripts/backfill-ich3-titles.ts          # dry run (default)
 *   npx tsx scripts/backfill-ich3-titles.ts --apply  # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { stripTitleKennelRunPrefix } from "../src/adapters/ical/adapter";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

const ICH3_ALIASES = ["ICH3"];
// Only a title that actually leads with the "ICH3[# ]*<digits>" prefix is a
// candidate. Single char class `[#\s]*` adjacent to `\d+` (disjoint classes) —
// provably linear, no ReDoS shape.
const ICH3_PREFIX_RE = /^ICH3[#\s]*\d+/i;

/**
 * Strip the `ICH3# N` prefix from a title, returning the cleaned title — or
 * null when the title doesn't carry the prefix (leave it untouched) or nothing
 * would change. Never extracts hares.
 */
export function stripIch3TitlePrefix(title: string): string | null {
  const trimmed = title.trim();
  if (!ICH3_PREFIX_RE.test(trimmed)) return null;
  const stripped = stripTitleKennelRunPrefix(trimmed, ICH3_ALIASES);
  if (!stripped || stripped === trimmed) return null;
  return stripped;
}

async function main() {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: "ich3" },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.error("ICH3 kennel not found — nothing to do.");
    await prisma.$disconnect();
    pool.end();
    return;
  }

  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true },
  });

  const updates: { id: string; oldTitle: string; newTitle: string }[] = [];
  for (const ev of events) {
    if (!ev.title) continue;
    const newTitle = stripIch3TitlePrefix(ev.title);
    if (newTitle) updates.push({ id: ev.id, oldTitle: ev.title, newTitle });
  }

  console.log(`ICH3 (${kennel.shortName}): ${updates.length} title(s) to strip`);
  for (const u of updates) {
    console.log(`  ${u.id}: "${u.oldTitle}" → "${u.newTitle}"`);
  }

  if (!dryRun) {
    for (const u of updates) {
      await prisma.event.update({ where: { id: u.id }, data: { title: u.newTitle } });
    }
  }

  console.log(`\n${dryRun ? "Would strip" : "Stripped"} ${updates.length} ICH3 title prefix(es).`);
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
