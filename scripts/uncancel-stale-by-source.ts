/**
 * Generalized version of `uncancel-gch3-stale.ts` (PR #1236) that restores
 * past CANCELLED events stale-cancelled before a source had `upcomingOnly: true`.
 *
 * Per Codex review on the original gch3 script:
 *   - Bulk-status sweeps over a kennel's CANCELLED rows are unsafe because
 *     adapter-driven legitimate cancellations land in the same status.
 *   - This script enforces source-attribution (event must have a RawEvent from
 *     the named source) AND a multi-scrape signature (≥2 RawEvent rows from
 *     that source), then requires the operator to confirm an explicit
 *     `--ids` allowlist before any write.
 *
 * Usage:
 *   1. List candidates for a source:
 *        BACKFILL_ALLOW_SELF_SIGNED_CERT=1 \
 *          npx tsx scripts/uncancel-stale-by-source.ts --source-id <sourceId>
 *   2. Review the printed shortlist by hand.
 *   3. Apply with the operator-confirmed allowlist:
 *        BACKFILL_ALLOW_SELF_SIGNED_CERT=1 \
 *          npx tsx scripts/uncancel-stale-by-source.ts --source-id <sourceId> \
 *            --apply --ids "id1,id2,id3"
 *      Pass `--ids ALL` to accept every printed candidate as-is.
 *
 *   --apply without --ids is rejected.
 *
 * Gating predicates (must all hold):
 *   - status = "CANCELLED"
 *   - adminCancelledAt IS NULL  (don't override admin-driven cancellations)
 *   - date < today              (the reconcile bug only affects past events)
 *   - has at least 2 RawEvent rows from --source-id
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const APPLY = process.argv.includes("--apply");

function parseArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || !process.argv[idx + 1]) return null;
  return process.argv[idx + 1];
}

function parseIdsArg(): string[] | "ALL" | null {
  const raw = parseArg("--ids");
  if (!raw) return null;
  if (raw === "ALL") return "ALL";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

interface Candidate {
  id: string;
  dateStr: string;
  runNumber: number | null;
  title: string | null;
  kennelCode: string | null;
  scrapeCount: number;
}

async function findCandidates(prisma: PrismaClient, sourceId: string): Promise<Candidate[]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const events = await prisma.event.findMany({
    where: {
      status: "CANCELLED",
      adminCancelledAt: null,
      date: { lt: today },
      rawEvents: { some: { sourceId } },
    },
    select: {
      id: true,
      date: true,
      runNumber: true,
      title: true,
      kennel: { select: { kennelCode: true } },
      rawEvents: { where: { sourceId }, select: { id: true } },
    },
    orderBy: { date: "asc" },
  });

  return events
    .filter((e) => e.rawEvents.length >= 2)
    .map((e) => ({
      id: e.id,
      dateStr: e.date.toISOString().slice(0, 10),
      runNumber: e.runNumber,
      title: e.title,
      kennelCode: e.kennel?.kennelCode ?? null,
      scrapeCount: e.rawEvents.length,
    }));
}

async function applyRestore(prisma: PrismaClient, sourceId: string, ids: string[] | "ALL") {
  // Re-validate every supplied ID against the same gating predicates the
  // candidate query uses — never trust the operator's allowlist alone.
  const candidates = await findCandidates(prisma, sourceId);
  const eligibleIds = new Set(candidates.map((c) => c.id));
  const requested = ids === "ALL" ? [...eligibleIds] : ids;
  const accepted = requested.filter((id) => eligibleIds.has(id));
  const rejected = requested.filter((id) => !eligibleIds.has(id));
  if (rejected.length > 0) {
    console.warn(`Rejected ${rejected.length} id(s) that don't match the candidate predicates:`);
    for (const id of rejected) console.warn(`  ${id}`);
  }
  if (accepted.length === 0) {
    throw new Error("No accepted ids — nothing to restore.");
  }
  console.log(`Restoring ${accepted.length} event(s) to CONFIRMED:`);
  for (const id of accepted) {
    const c = candidates.find((x) => x.id === id);
    if (c) console.log(`  ${c.id}  ${c.dateStr}  ${c.kennelCode ?? "?"}  #${c.runNumber ?? "?"}`);
  }
  const result = await prisma.event.updateMany({
    where: { id: { in: accepted }, status: "CANCELLED", adminCancelledAt: null },
    data: { status: "CONFIRMED" },
  });
  console.log(`\nFlipped ${result.count} event(s) back to CONFIRMED.`);
}

async function main() {
  const sourceId = parseArg("--source-id");
  if (!sourceId) {
    console.error("--source-id <id> is required");
    process.exit(1);
  }
  const ids = parseIdsArg();
  if (APPLY && !ids) {
    console.error('--apply requires --ids "id1,id2,..." (or --ids ALL)');
    process.exit(1);
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const source = await prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, name: true, type: true },
    });
    if (!source) {
      throw new Error(`Source ${sourceId} not found.`);
    }
    console.log(`Source: ${source.name} (${source.type})`);

    if (APPLY && ids) {
      await applyRestore(prisma, sourceId, ids);
      return;
    }

    const candidates = await findCandidates(prisma, sourceId);
    if (candidates.length === 0) {
      console.log("No stale-cancelled events found for this source.");
      return;
    }
    console.log(`Found ${candidates.length} candidate event(s):\n`);
    for (const c of candidates) {
      console.log(
        `  ${c.id}  ${c.dateStr}  ${c.kennelCode ?? "?"}  #${c.runNumber ?? "?"}  scrapes=${c.scrapeCount}  ${c.title ?? "(no title)"}`,
      );
    }
    console.log(`\nReview by hand, then re-run with:`);
    console.log(`  --apply --ids "${candidates.map((c) => c.id).join(",")}"`);
    console.log(`(or pass --ids ALL to accept every printed candidate as-is)`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
