/**
 * Post-merge cleanup for PR #1622 (Atlanta Hash Board parser fix).
 *
 * Before the parser fix, the adapter mis-extracted:
 *   - body `#NNN` tokens from street addresses and cross-kennel references
 *     (#2000 from "Kroger 8465 Holcomb Bridge Rd #2000", #946 from a Black
 *     Sheep cross-reference in a Moonlite post) → wrong `runNumber` on
 *     canonical Event rows;
 *   - phpBB post-banner timestamps as `startTime` (10:36 PM = last-post
 *     banner Sat May 02, 3:19 PM = first-post banner Sat Mar 28) → wrong
 *     `startTime` on canonical Event rows.
 *
 * A fresh scrape after merge will produce CORRECT RawEvents but the merge
 * pipeline upserts canonical Events keyed by (kennelId, date) — and Memory
 * `feedback_parser_fix_canonical_ghosts` documents that stale fields are
 * NOT automatically overwritten on UPDATE because the merge pipeline uses
 * `undefined` (preserve) vs `null` (clear) semantics. A new RawEvent with
 * `runNumber: 1664` (real number, from a fixed title-prefer path) will
 * land alongside the old wrong RawEvent and the canonical Event slot
 * won't be re-seeded with the correct fields until the merge pipeline
 * re-runs with a strict "drop and rebuild" path.
 *
 * Simplest cleanup: scrub the stale `runNumber` and `startTime` on the
 * affected MLH4 canonical Events. The next scrape (or backfill) then
 * populates the fields fresh.
 *
 * Targets:
 *   - MLH4 events with `runNumber` ∈ {2000, 946}     → clear runNumber
 *   - MLH4 events with `startTime` ∈ {22:36, 15:19}  → clear startTime
 *
 * We narrow to MLH4 (kennelCode = mlh4) to avoid touching any other
 * kennel that legitimately runs at 22:36 / 15:19 or has a real run #946 /
 * #2000.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-atlanta-canonical-ghosts.ts
 *   Apply:    APPLY=1 npx tsx scripts/cleanup-atlanta-canonical-ghosts.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const STALE_RUN_NUMBERS = new Set([2000, 946]);
const STALE_START_TIMES = new Set(["22:36", "15:19"]);
// Hard-scope the cleanup to the four known ghost dates from issues #1587/#1588.
// Without this, a future re-run could erase a legitimate runNumber/startTime
// that happens to land on the stale value cohort (e.g. if MLH4 ever runs trail
// #2000 for real, or holds an event at 22:36). CodeRabbit PR #1629 review.
const GHOST_DATES = new Set([
  "2026-03-30",
  "2026-04-20",
  "2026-05-04",
  "2026-05-11",
]);

interface RunNumberHit { id: string; date: Date; runNumber: number | null; title: string | null }
interface StartTimeHit { id: string; date: Date; startTime: string | null; title: string | null }

async function findStaleEvents(kennelId: string): Promise<{ runNumberHits: RunNumberHit[]; startTimeHits: StartTimeHit[] }> {
  const eventKennels = await prisma.eventKennel.findMany({
    where: { kennelId },
    select: {
      event: {
        select: { id: true, date: true, runNumber: true, startTime: true, title: true, sourceUrl: true },
      },
    },
  });
  console.log(`Inspecting ${eventKennels.length} MLH4-linked events…\n`);

  const runNumberHits: RunNumberHit[] = [];
  const startTimeHits: StartTimeHit[] = [];
  for (const ek of eventKennels) {
    const e = ek.event;
    // Hard-scope to known ghost dates (#1629 review): both value and date
    // must match so re-runs can't erase legitimate future data.
    const dateKey = e.date.toISOString().slice(0, 10);
    if (!GHOST_DATES.has(dateKey)) continue;
    if (e.runNumber != null && STALE_RUN_NUMBERS.has(e.runNumber)) {
      runNumberHits.push({ id: e.id, date: e.date, runNumber: e.runNumber, title: e.title });
    }
    if (e.startTime != null && STALE_START_TIMES.has(e.startTime)) {
      startTimeHits.push({ id: e.id, date: e.date, startTime: e.startTime, title: e.title });
    }
  }
  return { runNumberHits, startTimeHits };
}

function reportHits(runNumberHits: RunNumberHit[], startTimeHits: StartTimeHit[]): void {
  console.log(`Found ${runNumberHits.length} stale runNumber events:`);
  for (const h of runNumberHits) {
    console.log(`  · ${h.date.toISOString().slice(0, 10)} runNumber=${h.runNumber}  title=${h.title ?? "(null)"}`);
  }
  console.log(`\nFound ${startTimeHits.length} stale startTime events:`);
  for (const h of startTimeHits) {
    console.log(`  · ${h.date.toISOString().slice(0, 10)} startTime=${h.startTime}  title=${h.title ?? "(null)"}`);
  }
}

async function clearEventFields(runNumberHits: RunNumberHit[], startTimeHits: StartTimeHit[]): Promise<number> {
  let cleared = 0;
  for (const h of runNumberHits) {
    await prisma.event.update({ where: { id: h.id }, data: { runNumber: null } });
    cleared++;
  }
  for (const h of startTimeHits) {
    await prisma.event.update({ where: { id: h.id }, data: { startTime: null } });
    cleared++;
  }
  return cleared;
}

interface RawEventHit { id: string; rawData: Record<string, unknown> }

async function findStaleRawEvents(kennelId: string): Promise<RawEventHit[]> {
  // Find RawEvents whose payload carries the bad runNumber / startTime AND
  // belong to a MLH4 SourceKennel link — so a re-scrape doesn't immediately
  // re-write the wrong values via the same fingerprint.
  const mlh4Sources = await prisma.sourceKennel.findMany({
    where: { kennelId },
    select: { sourceId: true },
  });
  const sourceIds = mlh4Sources.map((s) => s.sourceId);
  if (sourceIds.length === 0) return [];

  const raws = await prisma.rawEvent.findMany({
    where: {
      sourceId: { in: sourceIds },
      OR: [
        { rawData: { path: ["runNumber"], equals: 2000 } },
        { rawData: { path: ["runNumber"], equals: 946 } },
        { rawData: { path: ["startTime"], equals: "22:36" } },
        { rawData: { path: ["startTime"], equals: "15:19" } },
      ],
    },
    select: { id: true, rawData: true },
  });
  // Filter to known ghost dates so re-runs can't strip legitimate future
  // payloads that happen to carry one of these specific stale values
  // (CodeRabbit PR #1629 review).
  return raws
    .map((r) => ({ id: r.id, rawData: r.rawData as Record<string, unknown> }))
    .filter((r) => typeof r.rawData.date === "string" && GHOST_DATES.has(r.rawData.date));
}

async function scrubRawEventPayloads(raws: RawEventHit[]): Promise<number> {
  let scrubbed = 0;
  for (const r of raws) {
    const d = r.rawData;
    let dirty = false;
    if (typeof d.runNumber === "number" && STALE_RUN_NUMBERS.has(d.runNumber)) {
      delete d.runNumber;
      dirty = true;
    }
    if (typeof d.startTime === "string" && STALE_START_TIMES.has(d.startTime)) {
      delete d.startTime;
      dirty = true;
    }
    if (dirty) {
      await prisma.rawEvent.update({ where: { id: r.id }, data: { rawData: d as never } });
      scrubbed++;
    }
  }
  return scrubbed;
}

async function main() {
  const apply = process.env.APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (writing to prod)" : "DRY RUN"}`);

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: "mlh4" },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.error("mlh4 kennel not found — aborting");
    process.exit(1);
  }
  console.log(`Target kennel: ${kennel.shortName} (id ${kennel.id})\n`);

  const { runNumberHits, startTimeHits } = await findStaleEvents(kennel.id);
  reportHits(runNumberHits, startTimeHits);

  // Discover RawEvents BEFORE the dry-run early-return so operators see
  // both layers' impact in dry-run mode (Gemini PR #1629 review).
  const rawHits = await findStaleRawEvents(kennel.id);
  console.log(`\nFound ${rawHits.length} stale RawEvent rows.`);

  if (!apply) {
    console.log("\nRe-run with APPLY=1 to scrub fields.");
    return;
  }

  const cleared = await clearEventFields(runNumberHits, startTimeHits);
  console.log(`\nCleared ${cleared} Event field(s).`);

  const scrubbed = await scrubRawEventPayloads(rawHits);
  console.log(`Scrubbed ${scrubbed} RawEvent payload(s).`);
}

main()
  .catch((e) => { console.warn(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
