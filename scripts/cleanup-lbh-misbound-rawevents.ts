/**
 * One-shot cleanup for the 107 LBH-PHX RawEvents that were misbound during
 * the first apply of `scripts/backfill-lbh-phx-history.ts` (PR #1628).
 *
 * Background:
 *   The initial backfill run bound to `"Phoenix H3 Events"` (the ICS source,
 *   trust=7) before reviewer feedback caught that the script actually scrapes
 *   the HTML Big Ass Calendar — which is a separate Source row,
 *   `"Phoenix H3 Big Ass Calendar"` (HTML_SCRAPER, trust=8). The corrected
 *   re-apply created the same 107 RawEvents under the right source. The
 *   misbound 107 still sit under the ICS source and pollute provenance
 *   (the ICS feed is upcoming-only and could never legitimately have
 *   produced these past-event rows).
 *
 * Safety:
 *   Each misbound RawEvent is paired against the canonical-source version
 *   by `rawData` shape comparison (date + runNumber + kennelTag — fingerprint
 *   is per-source so the SHA differs, but the underlying event identity is
 *   the same). Only RawEvents that have a confirmed twin under the canonical
 *   source are deleted. Canonical `Event` rows are NOT touched — they
 *   continue to resolve via the surviving high-trust source's RawEvents.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-lbh-misbound-rawevents.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-lbh-misbound-rawevents.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";

const ICS_SOURCE = "Phoenix H3 Events";
const CALENDAR_SOURCE = "Phoenix H3 Big Ass Calendar";
const KENNEL_TAG = "lbh-phx";
// The misbound apply happened on 2026-05-22; bound the cleanup window to
// that day so accumulated-over-years legitimate ICS RawEvents are safe.
const APPLY_DATE = "2026-05-22";

interface RawEventLike {
  id: string;
  fingerprint: string;
  scrapedAt: Date;
  eventId: string | null;
  rawData: unknown;
}

function eventKey(rawData: unknown): string | null {
  if (!rawData || typeof rawData !== "object") return null;
  const obj = rawData as { date?: unknown; runNumber?: unknown; kennelTags?: unknown };
  const date = typeof obj.date === "string" ? obj.date : null;
  const run = typeof obj.runNumber === "number" ? obj.runNumber : null;
  const tag = Array.isArray(obj.kennelTags) && typeof obj.kennelTags[0] === "string" ? obj.kennelTags[0] : null;
  if (!date || run == null || !tag) return null;
  return `${tag}|${date}|${run}`;
}

async function loadSources(): Promise<{ icsId: string; calId: string }> {
  const ics = await prisma.source.findFirst({ where: { name: ICS_SOURCE }, select: { id: true } });
  const cal = await prisma.source.findFirst({ where: { name: CALENDAR_SOURCE }, select: { id: true } });
  if (!ics || !cal) throw new Error("Missing one or both source rows");
  return { icsId: ics.id, calId: cal.id };
}

async function findMisboundCandidates(sourceId: string): Promise<RawEventLike[]> {
  const start = new Date(`${APPLY_DATE}T00:00:00Z`);
  const end = new Date(`${APPLY_DATE}T23:59:59Z`);
  return prisma.rawEvent.findMany({
    where: {
      sourceId,
      scrapedAt: { gte: start, lte: end },
      rawData: { path: ["kennelTags"], array_contains: KENNEL_TAG },
    },
    select: { id: true, fingerprint: true, scrapedAt: true, eventId: true, rawData: true },
  });
}

async function buildCanonicalKeySet(sourceId: string): Promise<Set<string>> {
  const rows = await prisma.rawEvent.findMany({
    where: {
      sourceId,
      rawData: { path: ["kennelTags"], array_contains: KENNEL_TAG },
    },
    select: { rawData: true },
  });
  const keys = new Set<string>();
  for (const r of rows) {
    const k = eventKey(r.rawData);
    if (k) keys.add(k);
  }
  return keys;
}

function partitionByTwin(candidates: RawEventLike[], canonicalKeys: Set<string>) {
  const safe: RawEventLike[] = [];
  const unsafe: RawEventLike[] = [];
  for (const c of candidates) {
    const k = eventKey(c.rawData);
    if (k && canonicalKeys.has(k)) safe.push(c);
    else unsafe.push(c);
  }
  return { safe, unsafe };
}

async function verifyNoOrphans(deleted: RawEventLike[]): Promise<void> {
  const eventIds = [...new Set(deleted.map((r) => r.eventId).filter((v): v is string => v != null))];
  if (eventIds.length === 0) {
    console.log("No deleted rows referenced a canonical Event; nothing to verify.");
    return;
  }
  const orphans = await prisma.event.findMany({
    where: { id: { in: eventIds }, rawEvents: { none: {} } },
    select: { id: true, date: true, runNumber: true },
  });
  if (orphans.length === 0) {
    console.log(`Verified: all ${eventIds.length} touched canonical Events still have at least one RawEvent backing.`);
    return;
  }
  console.warn(`WARNING: ${orphans.length} canonical Events lost all RawEvent backing:`);
  for (const o of orphans.slice(0, 5)) {
    console.warn(`  ${o.id} | ${o.date.toISOString().slice(0, 10)} #${o.runNumber}`);
  }
}

async function main(): Promise<void> {
  const apply = process.env.CLEANUP_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will delete)" : "DRY RUN (no writes)"}`);

  const { icsId, calId } = await loadSources();

  const candidates = await findMisboundCandidates(icsId);
  console.log(`Found ${candidates.length} misbound candidates under "${ICS_SOURCE}" scraped on ${APPLY_DATE}.`);

  const canonicalKeys = await buildCanonicalKeySet(calId);
  console.log(`Canonical source has ${canonicalKeys.size} keyed LBH RawEvents available as backstop.`);

  const { safe, unsafe } = partitionByTwin(candidates, canonicalKeys);
  console.log(`Safe to delete (twin exists under "${CALENDAR_SOURCE}"): ${safe.length}`);
  console.log(`UNSAFE (no canonical twin, will NOT delete): ${unsafe.length}`);

  if (!apply) {
    console.log("\nDry run complete. Re-run with CLEANUP_APPLY=1 to delete.");
    return;
  }
  if (safe.length === 0) {
    console.log("\nNothing to delete.");
    return;
  }

  const result = await prisma.rawEvent.deleteMany({ where: { id: { in: safe.map((r) => r.id) } } });
  console.log(`\nDeleted ${result.count} RawEvents.`);
  await verifyNoOrphans(safe);
}

main()
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error("FAILED:", message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
