/**
 * Repair past Gold Coast H3 (gch3-au) events that the reconcile pipeline
 * stale-cancelled before #1229 added `upcomingOnly: true` to the source row.
 *
 * The Gold Coast TablePress hareline strips past rows automatically — every
 * scrape after a run made the canonical Event look "missing from source",
 * which the reconciler then marked CANCELLED. The fix flips
 * `upcomingOnly: true` so reconcile no longer cancels past rows; this
 * script un-cancels the events that were already wrongly marked.
 *
 * Per Codex adversarial review (PR #1236): bulk-status sweeps over a
 * kennel's CANCELLED rows are unsafe because adapter-driven legitimate
 * cancellations land in the same status. This script therefore requires
 * an explicit allowlist of canonical Event IDs that the operator has
 * verified (e.g. by querying `prisma studio` and confirming each row was
 * cancelled by the upcomingOnly bug, not by the kennel).
 *
 * Usage:
 *   1. Identify candidate event IDs by running:
 *        npx tsx scripts/uncancel-gch3-stale.ts --candidates
 *      This prints a Gold-Coast-attributed shortlist (CANCELLED canonical
 *      events whose only RawEvent source is the Gold Coast hareline AND
 *      whose RawEvent history spans at least 2 scrapes — i.e. they were
 *      previously confirmed before the stale-cancel fired). Review the
 *      output by hand.
 *   2. Build a comma-separated allowlist of IDs you want to restore and
 *      run with --apply:
 *        npx tsx scripts/uncancel-gch3-stale.ts --apply --ids "id1,id2,id3"
 *
 *   --apply without --ids is rejected.
 *
 * The candidate query enforces:
 *   - kennel.kennelCode = "gch3-au"
 *   - status = "CANCELLED"
 *   - adminCancelledAt IS NULL  (don't override admin-driven cancellations)
 *   - date < today              (the reconcile bug only affects past events)
 *   - has at least one RawEvent from the Gold Coast Hareline source
 *   - RawEvent history shows 2+ scrapes from the Gold Coast source
 *     (proves the source previously emitted this event before dropping it)
 *
 * Closes #1229.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const KENNEL_CODE = "gch3-au";
const SOURCE_NAME = "Gold Coast H3 Hareline";
const APPLY = process.argv.includes("--apply");
const SHOW_CANDIDATES = process.argv.includes("--candidates");

function parseIdsArg(): string[] | null {
  const idx = process.argv.indexOf("--ids");
  if (idx === -1 || !process.argv[idx + 1]) return null;
  return process.argv[idx + 1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  if (APPLY && SHOW_CANDIDATES) {
    console.error("--apply and --candidates are mutually exclusive.");
    process.exit(1);
  }
  const ids = parseIdsArg();
  if (APPLY && (!ids || ids.length === 0)) {
    console.error("--apply requires --ids \"id1,id2,...\". See script docs.");
    process.exit(1);
  }

  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    if (APPLY && ids) {
      await applyRestore(prisma, ids);
      return;
    }

    // Default + --candidates: print the source-attributed shortlist.
    const candidates = await findCandidates(prisma);
    if (candidates.length === 0) {
      console.log("No Gold-Coast-attributed stale-cancelled events found.");
      return;
    }
    console.log(
      `Found ${candidates.length} candidate event(s) (Gold Coast attribution + multi-scrape history):\n`,
    );
    for (const c of candidates) {
      console.log(
        `  ${c.id}  ${c.dateStr}  #${c.runNumber ?? "?"}  scrapes=${c.scrapeCount}  ${c.title ?? "(no title)"}`,
      );
    }
    console.log("\nReview each row by hand, then run:");
    console.log(
      `  npx tsx scripts/uncancel-gch3-stale.ts --apply --ids "${candidates.map((c) => c.id).join(",")}"`,
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

interface Candidate {
  id: string;
  dateStr: string;
  runNumber: number | null;
  title: string | null;
  scrapeCount: number;
}

async function findCandidates(prisma: PrismaClient): Promise<Candidate[]> {
  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true },
  });
  if (!kennel) {
    console.error(`Kennel "${KENNEL_CODE}" not found.`);
    process.exit(1);
  }
  const source = await prisma.source.findFirst({
    where: { name: SOURCE_NAME },
    select: { id: true },
  });
  if (!source) {
    console.error(`Source "${SOURCE_NAME}" not found.`);
    process.exit(1);
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const events = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      status: "CANCELLED",
      adminCancelledAt: null,
      date: { lt: today },
      // Must have at least one RawEvent from the Gold Coast Hareline source
      // — this is the source-attribution gate Codex flagged as missing.
      rawEvents: { some: { sourceId: source.id } },
    },
    select: {
      id: true,
      date: true,
      runNumber: true,
      title: true,
      rawEvents: {
        where: { sourceId: source.id },
        select: { id: true },
      },
    },
    orderBy: { date: "asc" },
  });

  // The smoking-gun signature of a stale-reconcile cancellation: the source
  // emitted the event multiple times (2+ RawEvent rows), then stopped emitting
  // it after the run date. A real source-side cancellation typically has
  // exactly one RawEvent row (the source dropped it before re-scrape).
  return events
    .filter((e) => e.rawEvents.length >= 2)
    .map((e) => ({
      id: e.id,
      dateStr: e.date.toISOString().slice(0, 10),
      runNumber: e.runNumber,
      title: e.title,
      scrapeCount: e.rawEvents.length,
    }));
}

async function applyRestore(prisma: PrismaClient, ids: string[]) {
  // Re-validate every supplied ID against the same gating predicates the
  // candidate query uses — never trust the operator's allowlist alone.
  const candidates = await findCandidates(prisma);
  const eligibleIds = new Set(candidates.map((c) => c.id));
  const accepted = ids.filter((id) => eligibleIds.has(id));
  const rejected = ids.filter((id) => !eligibleIds.has(id));
  if (rejected.length > 0) {
    console.warn(
      `Rejected ${rejected.length} id(s) that don't match the candidate predicates:`,
    );
    for (const id of rejected) console.warn(`  ${id}`);
  }
  if (accepted.length === 0) {
    console.error("No accepted ids — nothing to restore.");
    process.exit(1);
  }
  console.log(`Restoring ${accepted.length} event(s) to CONFIRMED:`);
  for (const id of accepted) {
    const c = candidates.find((x) => x.id === id);
    if (c) console.log(`  ${c.id}  ${c.dateStr}  #${c.runNumber ?? "?"}`);
  }
  const result = await prisma.event.updateMany({
    where: { id: { in: accepted }, status: "CANCELLED", adminCancelledAt: null },
    data: { status: "CONFIRMED" },
  });
  console.log(`\nFlipped ${result.count} event(s) back to CONFIRMED.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
