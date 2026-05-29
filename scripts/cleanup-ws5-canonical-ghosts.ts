/**
 * One-shot cleanup for canonical Event field staleness left behind by
 * PR #1577 (WS5 source-mismatch bundle).
 *
 * Why this exists:
 * - PR #1577 changed how 6 adapters extract `hares` / `title` / `location`.
 * - The merge pipeline uses tri-state semantics: `undefined` = preserve
 *   existing, `null` = explicit clear, value = overwrite (see merge.ts
 *   line 1324). For cases where the new adapter logic now returns
 *   `undefined` (e.g., adapter rejects a value that was previously
 *   extracted), the canonical Event field is NOT cleared by the next
 *   scrape — it sticks with the pre-PR value.
 * - This script patches those stuck fields directly so the canonical
 *   Events match what the new adapter logic would produce on a fresh
 *   scrape.
 *
 * Per memory entry `feedback_parser_fix_canonical_ghosts`:
 *   "Fingerprint-changing fixes leave orphan Events + stale
 *    Kennel.lastEventDate; always plan the cleanup pass alongside the
 *    parser PR."
 *
 * In this case no canonical Events become orphans (all (kennelId, date)
 * slots still match between pre- and post-PR scrapes). The RVA
 * `CLAIM THIS TRAIL` events that the adapter now skips at ingest will
 * be marked CANCELLED automatically by the reconcile pipeline on the
 * next post-merge scrape — no manual deletion needed.
 *
 * Patches applied:
 *   - abqh3      : clear haresText that contains a slash-date (#1547)
 *   - wasatch-h3 : truncate haresText at first non-honorific sentence boundary (#1551)
 *   - mh3-tn / gynoh3 : strip trailing ` -` / ` —` / ` :` from title (#1557)
 *   - sth3-au    : strip "at the map location below" boilerplate from locationName (#1548)
 *   - bh4        : clear haresText where value is literal "Open" (#1550)
 *
 * RVA `CLAIM THIS TRAIL` events (#1549) are left alone — reconcile
 * cancels them automatically on next scrape.
 *
 * Usage:
 *   npx tsx scripts/cleanup-ws5-canonical-ghosts.ts             # dry run (default)
 *   npx tsx scripts/cleanup-ws5-canonical-ghosts.ts --apply     # apply changes
 *
 * Run on local-dev DB first (see .claude/rules/local-dev-db.md). Run
 * against prod only after the post-merge scrape has cleared all 6
 * affected sources (so future scrapes don't reintroduce stale values).
 */
import "dotenv/config";
import type { PrismaClient } from "@/generated/prisma/client";
import { stripMapBoilerplate } from "../src/adapters/html-scraper/sydney-thirsty-h3";
import { type FieldPatch, runFieldPatchCleanup } from "./lib/cleanup-cli";

/** Mirrors hare-extraction.ts: skip period boundaries preceded by an honorific. */
const HONORIFICS = new Set(["dr", "mr", "ms", "mrs", "st"]);

function findHareSentenceBoundary(text: string): number {
  const re = /\.\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const preceding = text.slice(0, m.index).split(/\s+/).pop()?.toLowerCase() ?? "";
    if (!HONORIFICS.has(preceding)) return m.index;
  }
  return -1;
}

function truncateAtSentence(value: string): string | null {
  const idx = findHareSentenceBoundary(value);
  if (idx < 0) return null;
  const tail = value.slice(idx + 1).trimStart();
  const tailTokens = tail.split(/\s+/).filter(Boolean);
  if (tailTokens.length < 3) return null;
  if (!/(?:^|\s)[a-z]/.test(tail)) return null;
  return value.slice(0, idx).trim();
}

/** Mirrors fb parser TITLE_TRAILING_DELIMITER_RE. Returns null when no change. */
function stripTitleTrailingDelimiter(title: string): string | null {
  // anchored end-of-string, single char class — Sonar-safe shape mirroring parser.ts:444
  const stripped = title.trimEnd().replace(/\s*[-–—:]\s*$/, "").trim(); // NOSONAR S5852 — anchored, single char class
  return stripped === title ? null : stripped;
}

/** Date-range shape: `\b<digits>/<digits>\b`. Real hare names don't carry slash-dates. */
function isDateRangeHares(value: string): boolean {
  return /\b\d{1,2}\s*\/\s*\d{1,2}\b/.test(value);
}

/** ABQ haresText with slash-date (#1547). */
async function collectAbqPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "abqh3" }, select: { id: true } });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, haresText: { contains: "/" } },
    select: { id: true, haresText: true },
  });
  return events
    .filter((e) => e.haresText && isDateRangeHares(e.haresText))
    .map((e) => ({ kennelLabel: "abqh3 #1547", eventId: e.id, field: "haresText" as const, before: e.haresText, after: null }));
}

/** Wasatch haresText sentence trailer (#1551). */
async function collectWasatchPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "wasatch-h3" }, select: { id: true } });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, haresText: { contains: ". " } },
    select: { id: true, haresText: true },
  });
  const patches: FieldPatch[] = [];
  for (const e of events) {
    if (!e.haresText) continue;
    const truncated = truncateAtSentence(e.haresText);
    if (truncated === null || truncated === e.haresText) continue;
    patches.push({ kennelLabel: "wasatch-h3 #1551", eventId: e.id, field: "haresText", before: e.haresText, after: truncated || null });
  }
  return patches;
}

/** Memphis FB title trailing delimiter (#1557). mh3-tn + gynoh3 via EventKennel join (GyNO via kennelPatterns). */
async function collectMemphisPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: ["mh3-tn", "gynoh3"] } },
    select: { id: true },
  });
  const ids = kennels.map((k) => k.id);
  if (ids.length === 0) return [];
  const events = await prisma.event.findMany({
    where: {
      title: { not: null },
      OR: [{ kennelId: { in: ids } }, { eventKennels: { some: { kennelId: { in: ids } } } }],
    },
    select: { id: true, title: true },
  });
  const patches: FieldPatch[] = [];
  for (const e of events) {
    if (!e.title) continue;
    const stripped = stripTitleTrailingDelimiter(e.title);
    if (stripped === null) continue;
    // `stripped || null` matches sanitizeTitle behavior (empty → null)
    patches.push({ kennelLabel: "mh3-tn/gynoh3 #1557", eventId: e.id, field: "title", before: e.title, after: stripped || null });
  }
  return patches;
}

/** STH3-AU locationName boilerplate (#1548). */
async function collectSthAuPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "sth3-au" }, select: { id: true } });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id, locationName: { contains: "at the map location below", mode: "insensitive" } },
    select: { id: true, locationName: true },
  });
  const patches: FieldPatch[] = [];
  for (const e of events) {
    if (!e.locationName) continue;
    const stripped = stripMapBoilerplate(e.locationName);
    if (stripped === e.locationName) continue;
    patches.push({ kennelLabel: "sth3-au #1548", eventId: e.id, field: "locationName", before: e.locationName, after: stripped || null });
  }
  return patches;
}

/** BH4 haresText "Open" placeholder (#1550). Routed via EventKennel (multi-kennel pattern). */
async function collectBh4Patches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const kennel = await prisma.kennel.findUnique({ where: { kennelCode: "bh4" }, select: { id: true } });
  if (!kennel) return [];
  const events = await prisma.event.findMany({
    where: {
      haresText: { equals: "Open", mode: "insensitive" },
      OR: [{ kennelId: kennel.id }, { eventKennels: { some: { kennelId: kennel.id } } }],
    },
    select: { id: true, haresText: true },
  });
  return events.map((e) => ({ kennelLabel: "bh4 #1550", eventId: e.id, field: "haresText" as const, before: e.haresText ?? null, after: null }));
}

async function collectPatches(prisma: PrismaClient): Promise<FieldPatch[]> {
  const blocks = await Promise.all([
    collectAbqPatches(prisma),
    collectWasatchPatches(prisma),
    collectMemphisPatches(prisma),
    collectSthAuPatches(prisma),
    collectBh4Patches(prisma),
  ]);
  return blocks.flat();
}

// summarize / apply / pool boilerplate is shared via runFieldPatchCleanup
// (scripts/lib/cleanup-cli.ts) — keep this script to its collectors only.
runFieldPatchCleanup(collectPatches, 5).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
