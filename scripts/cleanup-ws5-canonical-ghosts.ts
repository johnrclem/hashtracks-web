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
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { stripMapBoilerplate } from "../src/adapters/html-scraper/sydney-thirsty-h3";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

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

interface Patch {
  kennelLabel: string;
  eventId: string;
  field: "haresText" | "title" | "locationName";
  before: string | null;
  after: string | null;
}

async function collectPatches(prisma: PrismaClient): Promise<Patch[]> {
  const patches: Patch[] = [];

  // ── ABQ haresText with slash-date (#1547) ──────────────────────────
  const abqKennel = await prisma.kennel.findUnique({ where: { kennelCode: "abqh3" }, select: { id: true } });
  if (abqKennel) {
    const abqEvents = await prisma.event.findMany({
      where: { kennelId: abqKennel.id, haresText: { contains: "/" } },
      select: { id: true, haresText: true, date: true },
    });
    for (const e of abqEvents) {
      if (e.haresText && isDateRangeHares(e.haresText)) {
        patches.push({ kennelLabel: "abqh3 #1547", eventId: e.id, field: "haresText", before: e.haresText, after: null });
      }
    }
  }

  // ── Wasatch haresText sentence trailer (#1551) ─────────────────────
  const wasKennel = await prisma.kennel.findUnique({ where: { kennelCode: "wasatch-h3" }, select: { id: true } });
  if (wasKennel) {
    const wasEvents = await prisma.event.findMany({
      where: { kennelId: wasKennel.id, haresText: { contains: ". " } },
      select: { id: true, haresText: true, date: true },
    });
    for (const e of wasEvents) {
      if (!e.haresText) continue;
      const truncated = truncateAtSentence(e.haresText);
      if (truncated !== null && truncated !== e.haresText) {
        patches.push({ kennelLabel: "wasatch-h3 #1551", eventId: e.id, field: "haresText", before: e.haresText, after: truncated || null });
      }
    }
  }

  // ── Memphis FB title trailing delimiter (#1557) ────────────────────
  // mh3-tn + gynoh3 — via EventKennel join because GyNO events are routed via kennelPatterns
  const mhKennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: ["mh3-tn", "gynoh3"] } },
    select: { id: true, kennelCode: true },
  });
  const mhKennelIds = mhKennels.map((k) => k.id);
  if (mhKennelIds.length > 0) {
    const mhEvents = await prisma.event.findMany({
      where: {
        title: { not: null },
        OR: [
          { kennelId: { in: mhKennelIds } },
          { eventKennels: { some: { kennelId: { in: mhKennelIds } } } },
        ],
      },
      select: { id: true, title: true, date: true, kennelId: true },
    });
    for (const e of mhEvents) {
      if (!e.title) continue;
      const stripped = stripTitleTrailingDelimiter(e.title);
      if (stripped !== null) {
        // `stripped || null` matches sanitizeTitle behavior (empty → null)
        patches.push({ kennelLabel: "mh3-tn/gynoh3 #1557", eventId: e.id, field: "title", before: e.title, after: stripped || null });
      }
    }
  }

  // ── STH3-AU locationName boilerplate (#1548) ───────────────────────
  const sthKennel = await prisma.kennel.findUnique({ where: { kennelCode: "sth3-au" }, select: { id: true } });
  if (sthKennel) {
    const sthEvents = await prisma.event.findMany({
      where: { kennelId: sthKennel.id, locationName: { contains: "at the map location below", mode: "insensitive" } },
      select: { id: true, locationName: true, date: true },
    });
    for (const e of sthEvents) {
      if (!e.locationName) continue;
      const stripped = stripMapBoilerplate(e.locationName);
      if (stripped !== e.locationName) {
        patches.push({ kennelLabel: "sth3-au #1548", eventId: e.id, field: "locationName", before: e.locationName, after: stripped || null });
      }
    }
  }

  // ── BH4 haresText "Open" placeholder (#1550) ───────────────────────
  // BH4 events are routed via EventKennel (multi-kennel pattern). Match
  // via either primary or secondary kennel link to catch both shapes.
  const bh4Kennel = await prisma.kennel.findUnique({ where: { kennelCode: "bh4" }, select: { id: true } });
  if (bh4Kennel) {
    const bh4Events = await prisma.event.findMany({
      where: {
        haresText: { equals: "Open", mode: "insensitive" },
        OR: [
          { kennelId: bh4Kennel.id },
          { eventKennels: { some: { kennelId: bh4Kennel.id } } },
        ],
      },
      select: { id: true, haresText: true, date: true },
    });
    for (const e of bh4Events) {
      patches.push({ kennelLabel: "bh4 #1550", eventId: e.id, field: "haresText", before: e.haresText ?? null, after: null });
    }
  }

  return patches;
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
    for (const p of list.slice(0, 5)) {
      console.log(`  ${p.eventId} ${p.field}:`);
      console.log(`    - before: ${JSON.stringify(p.before)}`);
      console.log(`    + after:  ${JSON.stringify(p.after)}`);
    }
    if (list.length > 5) console.log(`  … (${list.length - 5} more)`);
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
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made" : "✏️  APPLYING changes");
  console.log(`DATABASE_URL host: ${new URL(process.env.DATABASE_URL!).host}\n`);

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
