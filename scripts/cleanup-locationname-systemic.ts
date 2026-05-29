/**
 * One-shot cleanup for stale canonical `Event.locationName` (and stale GREY
 * `Event.title`) left behind by the systemic locationName-extraction fix
 * (issues #1729 #1730 #1731 #1747 #1749 / #1217).
 *
 * Why this exists:
 * - The merge pipeline uses tri-state field semantics: `undefined` = preserve
 *   existing, `null` = explicit clear, value = overwrite (see merge.ts).
 * - The adapter fixes make the scrapers now RETURN a cleaned value or
 *   `undefined` for the affected runs. Cases where the new logic returns a
 *   *value* (e.g. Hague "…Rijswijk (Link)" → "…Rijswijk", Norfolk
 *   "Maybe, … T.B.C" → "The Maids Head, …") self-heal on the next scrape
 *   because merge overwrites. Cases where it now returns `undefined`
 *   (GREY "Contact … to set this run", TTH3 "Hares: Sexy Hares Needed",
 *   Norfolk "T.B.A") do NOT — merge preserves the stale canonical value.
 * - This script patches those stuck fields directly so the canonical Events
 *   match what the fixed adapters would produce on a fresh scrape.
 *
 * Per memory `feedback_parser_fix_canonical_ghosts`: fingerprint-changing
 * fixes leave stale canonical fields; plan the cleanup pass alongside the
 * parser PR.
 *
 * Collectors:
 *   - locations : for hagueh3 / tth3-ab / norfolkh3 / bristol-grey, re-run
 *     `cleanLocationName` over the stored locationName and patch when it
 *     changes (to a cleaned value OR null).
 *   - sh3-au    : null locationName when it merely duplicates haresText — the
 *     #1731 field-swap leak (run #3078). Requires the post-merge re-scrape to
 *     have repopulated haresText first (see Usage), so the duplicate is
 *     detectable.
 *   - GREY title: rewrite stale "GREY Trail[ #N]" → "Bristol Greyhound H3
 *     Trail[ #N]" via the canonical merge helper (#1217 / #1184).
 *
 * Usage:
 *   npx tsx scripts/cleanup-locationname-systemic.ts            # dry run (default)
 *   npx tsx scripts/cleanup-locationname-systemic.ts --apply    # apply changes
 *
 * Run on the local-dev DB first (see .claude/rules/local-dev-db.md). Run
 * against prod only AFTER the post-merge scrape has re-run the five affected
 * sources (so the sh3-au haresText duplicate is detectable and future scrapes
 * don't reintroduce stale values).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { cleanLocationName } from "../src/adapters/utils";
import { rewriteStaleDefaultTitle } from "@/pipeline/merge";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

// Single-kennel sources whose locationName is re-cleanable in place. The
// generic GREY source also feeds bristolh3, but cleanLocationName is a no-op
// on legitimate Bristol venues so scoping to bristol-grey is sufficient.
const LOCATION_KENNELS = ["hagueh3", "tth3-ab", "norfolkh3", "bristol-grey"];

interface Patch {
  kennelLabel: string;
  eventId: string;
  field: "locationName" | "title";
  before: string | null;
  after: string | null;
}

/** Re-clean stored locationName for the affected kennels (#1729/#1730/#1747/#1749). */
async function collectLocationPatches(prisma: PrismaClient): Promise<Patch[]> {
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: LOCATION_KENNELS } },
    select: { id: true, kennelCode: true },
  });
  const patches: Patch[] = [];
  for (const kennel of kennels) {
    const events = await prisma.event.findMany({
      where: { kennelId: kennel.id, locationName: { not: null } },
      select: { id: true, locationName: true },
    });
    for (const e of events) {
      if (!e.locationName) continue;
      const cleaned = cleanLocationName(e.locationName);
      // cleanLocationName returns string | null; compare against the stored
      // value (treat "no change" as a skip).
      if ((cleaned ?? null) === e.locationName) continue;
      patches.push({
        kennelLabel: `${kennel.kennelCode} location`,
        eventId: e.id,
        field: "locationName",
        before: e.locationName,
        after: cleaned,
      });
    }
  }
  return patches;
}

/** Null sh3-au locationName values that merely duplicate haresText (#1731 #3078). */
async function collectSh3DuplicateHaresPatches(prisma: PrismaClient): Promise<Patch[]> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: "sh3-au" },
    select: { id: true },
  });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, locationName: { not: null }, haresText: { not: null } },
    select: { id: true, locationName: true, haresText: true },
  });
  return events
    .filter(
      (e) =>
        e.locationName != null &&
        e.haresText != null &&
        e.locationName.trim().toLowerCase() === e.haresText.trim().toLowerCase(),
    )
    .map((e) => ({
      kennelLabel: "sh3-au location==hares (#1731)",
      eventId: e.id,
      field: "locationName" as const,
      before: e.locationName,
      after: null,
    }));
}

/** Rewrite stale "GREY Trail" titles to the current display name (#1217/#1184). */
async function collectGreyTitlePatches(prisma: PrismaClient): Promise<Patch[]> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: "bristol-grey" },
    select: { id: true, kennelCode: true, shortName: true, fullName: true },
  });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true },
  });
  const patches: Patch[] = [];
  for (const e of events) {
    if (!e.title) continue;
    // "GREY" is the kennel's canonical alias (aliases.ts) — pass it so the
    // shared rewriter recognizes the stale "GREY Trail" prefix.
    const rewritten = rewriteStaleDefaultTitle(
      e.title,
      kennel.kennelCode,
      kennel.shortName,
      kennel.fullName,
      ["GREY"],
    );
    if (rewritten === e.title) continue;
    patches.push({
      kennelLabel: "bristol-grey title (#1217)",
      eventId: e.id,
      field: "title",
      before: e.title,
      after: rewritten,
    });
  }
  return patches;
}

async function collectPatches(prisma: PrismaClient): Promise<Patch[]> {
  const blocks = await Promise.all([
    collectLocationPatches(prisma),
    collectSh3DuplicateHaresPatches(prisma),
    collectGreyTitlePatches(prisma),
  ]);
  return blocks.flat();
}

function summarize(patches: Patch[]): void {
  const byKennel = new Map<string, Patch[]>();
  for (const p of patches) {
    const list = byKennel.get(p.kennelLabel) ?? [];
    list.push(p);
    byKennel.set(p.kennelLabel, list);
  }
  for (const [label, list] of [...byKennel.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`\n${label}: ${list.length} event(s)`);
    for (const p of list.slice(0, 8)) {
      console.log(`  ${p.eventId} ${p.field}:`);
      console.log(`    - before: ${JSON.stringify(p.before)}`);
      console.log(`    + after:  ${JSON.stringify(p.after)}`);
    }
    if (list.length > 8) console.log(`  … (${list.length - 8} more)`);
  }
}

async function applyPatches(prisma: PrismaClient, patches: Patch[]): Promise<void> {
  for (const p of patches) {
    await prisma.event.update({
      where: { id: p.eventId },
      data: { [p.field]: p.after },
    });
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made" : "✏️  APPLYING changes");
  console.log(`DATABASE_URL host: ${new URL(databaseUrl).host}\n`);

  const patches = await collectPatches(prisma);
  summarize(patches);
  console.log(`\nTotal: ${patches.length} event field(s) to patch.`);

  if (patches.length > 0 && !dryRun) {
    console.log("\nApplying patches...");
    await applyPatches(prisma, patches);
    console.log(`✓ Applied ${patches.length} patch(es).`);
  } else if (dryRun) {
    console.log("\nRun with --apply to commit changes.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
