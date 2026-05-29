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
import type { PrismaClient } from "@/generated/prisma/client";
import { cleanLocationName } from "../src/adapters/utils";
import { rewriteStaleDefaultTitle } from "@/pipeline/merge";
import { type FieldPatch, runFieldPatchCleanup } from "./lib/cleanup-cli";

// Single-kennel sources whose locationName is re-cleanable in place. The
// generic GREY source also feeds bristolh3, but cleanLocationName is a no-op
// on legitimate Bristol venues so scoping to bristol-grey is sufficient.
const LOCATION_KENNELS = ["hagueh3", "tth3-ab", "norfolkh3", "bristol-grey"];

/** Re-clean stored locationName for the affected kennels (#1729/#1730/#1747/#1749). */
async function collectLocationPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: LOCATION_KENNELS } },
    select: { id: true, kennelCode: true },
  });
  const patches: FieldPatch[] = [];
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
async function collectSh3DuplicateHaresPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
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
async function collectGreyTitlePatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: "bristol-grey" },
    select: { id: true, kennelCode: true, shortName: true, fullName: true },
  });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, title: { not: null } },
    select: { id: true, title: true },
  });
  const patches: FieldPatch[] = [];
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

async function collectPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const blocks = await Promise.all([
    collectLocationPatches(prisma),
    collectSh3DuplicateHaresPatches(prisma),
    collectGreyTitlePatches(prisma),
  ]);
  return blocks.flat();
}

runFieldPatchCleanup(collectPatches).catch((err) => {
  console.error(err);
  // Set exitCode rather than process.exit() so the event loop drains cleanly.
  process.exitCode = 1;
});
