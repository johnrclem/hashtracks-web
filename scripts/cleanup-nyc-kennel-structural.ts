/**
 * One-shot prod reconciliation for the HashNYC structural cleanup
 * (#1852, #1855, #1856, #1858, #1859, #1860).
 *
 * The HashNYC HTML_SCRAPER routed events by the LEADING words of the event
 * title instead of the trailing "<kennel> #<run>" designation, so:
 *   - 2 NAWW events ("New Amsterdam Winter Wednesday AGM! - NAWW #298",
 *     "… - NAWW #356") anchored to "New Amsterdam" → landed on `nah3`.
 *   - 3 NYCH3 Special events ("Drinking Practice - Special #137/#232/#234")
 *     anchored to "Drinking Practice" → landed on `drinking-practice-nyc`.
 * The adapter fix (`extractKennelTag` designation-first) stops this going
 * forward; these already-ingested canonicals are historical and the source
 * is `upcomingOnly`, so they never re-scrape — reassign them here.
 *
 * Also patches the 3 kennel profile rows to the audited values. The kennel
 * seed merge only fills NULLs and never touches shortName/fullName
 * (prisma/seed.ts), so the `nah3` rename (NAH3 → "NASS H3") and its schedule
 * corrections can only reach prod through this script. The desired field
 * values are read straight from prisma/seed-data/kennels.ts so seed stays the
 * single source of truth (same pattern as cleanup-cross-kennel-conflation.ts).
 *
 * Reassign-not-insert (memory: feedback_aggregator_misroute_reassign_not_insert)
 * via the slot-safe `reassignEventKennel` helper; RawEvents are left untouched.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/cleanup-nyc-kennel-structural.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/cleanup-nyc-kennel-structural.ts
 */

import "dotenv/config";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";
import { reassignEventKennel } from "./lib/event-reassign";
import { KENNELS } from "../prisma/seed-data/kennels";

const APPLY = process.env.BACKFILL_APPLY === "1";

// Audited event re-attributions (IDs verified against prod).
const EVENT_MOVES: ReadonlyArray<{ id: string; from: string; to: string; label: string }> = [
  { id: "cmmk01f9w01zx04l1bkvkidz7", from: "nah3", to: "nawwh3", label: "NAWW #298" },
  { id: "cmmjzzyti00tm04l1wtys100p", from: "nah3", to: "nawwh3", label: "NAWW #356" },
  { id: "cmmk00max01bz04l16me6hsy2", from: "drinking-practice-nyc", to: "nych3", label: "Special #137" },
  { id: "cmmjzzcmi00bn04l114bqq7od", from: "drinking-practice-nyc", to: "nych3", label: "Special #232" },
  { id: "cmmjzzbjt00au04l1gup4kaw9", from: "drinking-practice-nyc", to: "nych3", label: "Special #234" },
];

// Profile fields this script reconciles from the seed row → prod. shortName /
// fullName / slug are included so the nah3 rename reaches prod (seed-merge
// never updates them). region/regionId are deliberately omitted (seed owns them).
const PATCH_FIELDS = [
  "slug", "shortName", "fullName", "website", "logoUrl",
  "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  "foundedYear", "founder", "description", "contactEmail",
  "facebookUrl", "instagramHandle", "gm", "hareRaiser", "parentKennelCode",
] as const;

const KENNELS_TO_PATCH = ["nah3", "nawwh3", "drinking-practice-nyc"] as const;

async function resolveKennelIds(prisma: PrismaClient, codes: string[]): Promise<Map<string, string>> {
  const rows = await prisma.kennel.findMany({
    where: { kennelCode: { in: codes } },
    select: { id: true, kennelCode: true },
  });
  const map = new Map(rows.map((r) => [r.kennelCode, r.id]));
  for (const code of codes) {
    if (!map.has(code)) throw new Error(`Kennel "${code}" not found — run prisma db seed first.`);
  }
  return map;
}

async function reattributeEvents(prisma: PrismaClient, kennelIds: Map<string, string>) {
  console.log("── Re-attributing misrouted events ──");
  for (const move of EVENT_MOVES) {
    const event = await prisma.event.findUnique({
      where: { id: move.id },
      select: { id: true, date: true, kennelId: true, title: true },
    });
    if (!event) {
      console.warn(`  ⚠ ${move.label} (${move.id}) not found — skipping.`);
      continue;
    }
    const fromId = kennelIds.get(move.from)!;
    const toId = kennelIds.get(move.to)!;
    if (event.kennelId === toId) {
      console.log(`  ✓ ${move.label}: already on ${move.to} — no-op.`);
      continue;
    }
    if (event.kennelId !== fromId) {
      console.warn(`  ⚠ ${move.label}: expected on ${move.from} but sits elsewhere (${event.kennelId}) — skipping.`);
      continue;
    }
    const iso = event.date.toISOString().slice(0, 10);
    const slotTaken = await prisma.event.findFirst({
      where: { kennelId: toId, date: event.date, isCanonical: true, id: { not: event.id } },
      select: { id: true },
    });
    if (slotTaken) {
      console.log(`  [delete-dup] ${move.label} ${iso}: ${move.to} already has a canonical (${slotTaken.id}); cascade-deleting ghost ${event.id}.`);
      if (APPLY) await cascadeDeleteEvents(prisma, [event.id]);
    } else {
      console.log(`  [reassign] ${move.label} ${iso}: ${move.from} → ${move.to}.`);
      if (APPLY) await reassignEventKennel(prisma, event.id, fromId, toId);
    }
  }
}

function desiredPatchFromSeed(kennelCode: string): Record<string, unknown> {
  const seed = KENNELS.find((k) => k.kennelCode === kennelCode);
  if (!seed) throw new Error(`No seed row for "${kennelCode}".`);
  const patch: Record<string, unknown> = {};
  const seedRecord = seed as unknown as Record<string, unknown>;
  for (const field of PATCH_FIELDS) {
    const value = seedRecord[field];
    if (value !== undefined) patch[field] = value;
  }
  return patch;
}

async function patchKennelProfiles(prisma: PrismaClient) {
  console.log("\n── Patching kennel profile rows (seed → prod) ──");
  for (const code of KENNELS_TO_PATCH) {
    const current = await prisma.kennel.findUnique({ where: { kennelCode: code } });
    if (!current) {
      console.warn(`  ⚠ ${code} not found — skipping.`);
      continue;
    }
    const desired = desiredPatchFromSeed(code);
    const currentRecord = current as unknown as Record<string, unknown>;
    const diff: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(desired)) {
      if (currentRecord[field] !== value) diff[field] = value;
    }
    if (Object.keys(diff).length === 0) {
      console.log(`  ✓ ${code}: already up to date.`);
      continue;
    }
    console.log(`  ~ ${code}: setting ${Object.keys(diff).join(", ")}`);
    if (APPLY) await prisma.kennel.update({ where: { id: current.id }, data: diff });
  }
}

async function main() {
  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    console.log(`Mode: ${APPLY ? "APPLY (writes enabled)" : "DRY RUN"}\n`);
    // Derive the code set from the data so a typo in EVENT_MOVES/KENNELS_TO_PATCH
    // surfaces as the friendly "not found" error, never a raw undefined deref.
    const codes = [...new Set([...EVENT_MOVES.flatMap((m) => [m.from, m.to]), ...KENNELS_TO_PATCH])];
    const kennelIds = await resolveKennelIds(prisma, codes);
    await reattributeEvents(prisma, kennelIds);
    await patchKennelProfiles(prisma);
    console.log(`\nDone. ${APPLY ? "Changes committed." : "No changes — pass BACKFILL_APPLY=1 to apply."}`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("FAILED:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
