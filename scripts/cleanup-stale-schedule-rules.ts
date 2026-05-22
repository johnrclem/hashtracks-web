/**
 * One-shot cleanup for stale `ScheduleRule` rows that would render as a
 * bare day label (no time) when a sibling row already covers the same day
 * with a real time. Per issue #1552 (LRH3) and PR #1577's defense-in-depth
 * UI fix in `formatScheduleRules` (src/lib/format.ts).
 *
 * Why this exists:
 * - Pass-1 of `backfill-schedule-rules.ts` creates STATIC_SCHEDULE rules
 *   with real `startTime` from Source.config.
 * - Pass-2 reads Kennel.scheduleDayOfWeek / Kennel.scheduleTime. When
 *   scheduleTime is null but scheduleDayOfWeek is set, it created a
 *   SEED_DATA rule with `startTime: null` for the same day Pass-1
 *   already covered.
 * - The Pass-2-skip fix prevents NEW duplicates and flipped these rows
 *   to `isActive: false`, but the rows still exist in the DB.
 * - This script hard-deletes them so the data matches the rendered UI.
 *
 * Match criteria (conservative):
 *   - target row: `isActive=false`, `startTime IS NULL`, no season hint
 *     (label/validFrom/validUntil all NULL)
 *   - has an ACTIVE peer on the same kennel with the same BYDAY weekday
 *     and a non-null `startTime`
 *
 * Bare-day rows WITHOUT a timed peer on the same day (e.g. bjh3 SA bare
 * vs WE timed) are NOT deleted — they represent a real-but-incomplete
 * schedule the kennel may want to flesh out, not a stale duplicate.
 *
 * Usage:
 *   npx tsx scripts/cleanup-stale-schedule-rules.ts             # dry run (default)
 *   npx tsx scripts/cleanup-stale-schedule-rules.ts --apply     # apply changes
 *
 * Requires `BACKFILL_ALLOW_SELF_SIGNED_CERT=1` for Railway prod proxy.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const dryRun = !process.argv.includes("--apply");

/**
 * Extract the BYDAY value from an RRULE string. Returns null if missing.
 * Char class includes digits + `+`/`-` so monthly nth-weekday shapes
 * (`BYDAY=1SA`, `BYDAY=-1SU`) extract cleanly (Gemini review on #1598).
 * Quantifier stays `+` (not `*`) — an empty BYDAY is not a usable day
 * signal and must skip rather than match across rows.
 */
function extractByDay(rrule: string): string | null {
  const m = /BYDAY=([0-9A-Z,+-]+)/.exec(rrule);
  return m ? m[1] : null;
}

interface Candidate {
  kennelCode: string;
  staleId: string;
  staleRrule: string;
  staleSource: string;
  peerId: string;
  peerRrule: string;
  peerStartTime: string;
}

async function findCandidates(prisma: PrismaClient): Promise<Candidate[]> {
  // Step 1: pull all candidate stale rows + kennelCode in one query
  // (drop the per-row kennel.findUnique — Gemini review on #1598).
  const staleRows = await prisma.scheduleRule.findMany({
    where: {
      isActive: false,
      startTime: null,
      label: null,
      validFrom: null,
      validUntil: null,
    },
    select: {
      id: true,
      kennelId: true,
      rrule: true,
      source: true,
      kennel: { select: { kennelCode: true } },
    },
    take: 1000,
  });

  if (staleRows.length === 0) return [];

  // Step 2: bulk-fetch active timed peers for the relevant kennels once,
  // group by kennelId in memory. Avoids the prior N+1 per stale row.
  const kennelIds = [...new Set(staleRows.map((s) => s.kennelId))];
  const activePeers = await prisma.scheduleRule.findMany({
    where: {
      kennelId: { in: kennelIds },
      isActive: true,
      startTime: { not: null },
    },
    select: { id: true, kennelId: true, rrule: true, startTime: true },
    take: 1000,
  });

  const peersByKennel = new Map<string, typeof activePeers>();
  for (const peer of activePeers) {
    const list = peersByKennel.get(peer.kennelId) ?? [];
    list.push(peer);
    peersByKennel.set(peer.kennelId, list);
  }

  const candidates: Candidate[] = [];
  for (const stale of staleRows) {
    const staleByDay = extractByDay(stale.rrule);
    if (!staleByDay) continue;

    const peers = peersByKennel.get(stale.kennelId) ?? [];
    const matchingPeer = peers.find((p) => extractByDay(p.rrule) === staleByDay);
    if (!matchingPeer?.startTime) continue;

    candidates.push({
      kennelCode: stale.kennel?.kennelCode ?? "?",
      staleId: stale.id,
      staleRrule: stale.rrule,
      staleSource: stale.source,
      peerId: matchingPeer.id,
      peerRrule: matchingPeer.rrule,
      peerStartTime: matchingPeer.startTime,
    });
  }
  return candidates;
}

function summarize(candidates: Candidate[]): void {
  if (candidates.length === 0) {
    console.log("No stale subsumed ScheduleRule rows found.");
    return;
  }
  for (const c of candidates) {
    console.log(`\n${c.kennelCode}`);
    console.log(`  - DELETE ${c.staleId} ${c.staleRrule} (no startTime, source=${c.staleSource}, isActive=false)`);
    console.log(`  + KEEP   ${c.peerId} ${c.peerRrule} startTime=${c.peerStartTime}`);
  }
}

async function applyDeletes(prisma: PrismaClient, candidates: Candidate[]): Promise<void> {
  const ids = candidates.map((c) => c.staleId);
  const { count } = await prisma.scheduleRule.deleteMany({ where: { id: { in: ids } } });
  console.log(`\n✓ Deleted ${count} ScheduleRule row(s).`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made" : "✏️  APPLYING changes");
  console.log(`DATABASE_URL host: ${new URL(databaseUrl).host}\n`);

  const candidates = await findCandidates(prisma);
  summarize(candidates);
  console.log(`\nTotal: ${candidates.length} stale row(s) to delete.`);

  if (candidates.length > 0 && !dryRun) {
    await applyDeletes(prisma, candidates);
  } else if (dryRun && candidates.length > 0) {
    console.log("\nRun with --apply to commit changes.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
