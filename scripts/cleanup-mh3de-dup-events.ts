/**
 * One-shot cleanup for the Munich H3 (mh3-de) duplicate / orphan canonical
 * Events reported in #1784.
 *
 * Background:
 *   The Munich shared GOOGLE_SHEETS source historically collapsed two
 *   legitimate same-day MH3 runs (the Munich-area #938 and the Hashathon
 *   co-host #939, both 20-Jun-26) onto one canonical row because the
 *   pre-WS1 merge pipeline keyed canonical Events on (kennelId, date) alone.
 *   WS1 added same-day double-header support (eventSignature keyed on
 *   runNumber), so a re-scrape now yields #938 and #939 as two distinct rows.
 *   A second artifact remained: an orphan #940 on 18-Jul-26. Its source row
 *   (#941, "18-Jul-02") carries a year typo that parses to 2002 and is
 *   filtered out of the scrape window, so the reconciler CANCELLED the row
 *   but left it behind as a source-less phantom duplicating the real
 *   4-Jul-26 #940.
 *
 * What this deletes (mh3-de only, narrow + verified):
 *   1. ORPHANS — canonical Events with status=CANCELLED, ZERO backing
 *      RawEvents, ZERO attendances, and no admin lock (adminCancelledAt null).
 *      These have no source and cannot be re-created (the typo'd source row is
 *      out of window). The 18-Jul-26 #940 phantom is the live instance.
 *   2. TRUE DUPLICATES — if 2+ live (non-cancelled) Events still share the
 *      same (date, runNumber), keep the best-supported one (most RawEvents,
 *      then most attendances) and delete the rest, but ONLY when the
 *      to-delete rows have ZERO attendances and no admin lock. As of the
 *      pre-merge prod check the Jun-20 dup had already self-healed, so this
 *      branch is defensive and a no-op on current prod.
 *
 * Canonical Events that still have RawEvents or attendances, or are
 * admin-locked, are NEVER touched. EventKennel rows cascade on Event delete;
 * EventLinks are removed explicitly first.
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-mh3de-dup-events.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-mh3de-dup-events.ts
 */

import "dotenv/config";
import { prisma } from "@/lib/db";

const APPLY = process.env.CLEANUP_APPLY === "1";

interface Candidate {
  id: string;
  date: string;
  runNumber: number | null;
  title: string | null;
  reason: string;
}

interface CleanupEvent {
  id: string;
  date: Date;
  runNumber: number | null;
  title: string | null;
  status: string;
  adminCancelledAt: Date | null;
  rawEvents: { id: string }[];
  attendances: { id: string }[];
}

/** An Event we may delete: source-less (0 raws), attendance-free, unlocked. */
function isSafe(e: CleanupEvent): boolean {
  return e.rawEvents.length === 0 && e.attendances.length === 0 && e.adminCancelledAt === null;
}

const candidate = (e: CleanupEvent, reason: string): Candidate => ({
  id: e.id,
  date: e.date.toISOString().slice(0, 10),
  runNumber: e.runNumber,
  title: e.title,
  reason,
});

/** Cancelled, source-less, attendance-free, unlocked → safe to delete. */
function findOrphans(events: CleanupEvent[]): Candidate[] {
  return events
    .filter((e) => e.status === "CANCELLED" && isSafe(e))
    .map((e) => candidate(e, "orphan (cancelled, 0 raws, 0 attns, unlocked)"));
}

/**
 * True duplicates among LIVE events sharing (date, runNumber): keep the
 * best-supported row, delete the rest — but only when a to-delete row is ALSO
 * `isSafe` (a duplicate with backing RawEvents needs manual review; blind
 * deletion would orphan its raws and force a delete→regenerate churn).
 */
function findDuplicates(events: CleanupEvent[]): Candidate[] {
  const liveByKey = new Map<string, CleanupEvent[]>();
  for (const e of events) {
    if (e.status === "CANCELLED" || e.runNumber == null) continue;
    const key = `${e.date.toISOString().slice(0, 10)}#${e.runNumber}`;
    let bucket = liveByKey.get(key);
    if (!bucket) {
      bucket = [];
      liveByKey.set(key, bucket);
    }
    bucket.push(e);
  }
  const support = (e: CleanupEvent) => e.rawEvents.length * 1000 + e.attendances.length;
  const out: Candidate[] = [];
  for (const [key, group] of liveByKey) {
    if (group.length < 2) continue;
    const [keep, ...rest] = [...group].sort((a, b) => support(b) - support(a));
    console.log(`  duplicate group ${key}: keeping ${keep.id} (raws=${keep.rawEvents.length})`);
    for (const e of rest) {
      if (isSafe(e)) out.push(candidate(e, `duplicate of ${keep.id} (lower support)`));
      else console.log(`    SKIP ${e.id} — has RawEvents, attendances, or admin lock; manual review`);
    }
  }
  return out;
}

async function main() {
  const kennel = await prisma.kennel.findFirst({
    where: { kennelCode: "mh3-de" },
    select: { id: true, kennelCode: true, shortName: true },
  });
  if (!kennel) {
    console.error("mh3-de kennel not found — aborting");
    return;
  }
  console.log(`Kennel: ${kennel.shortName} (${kennel.kennelCode}) ${kennel.id}`);

  const events = await prisma.event.findMany({
    where: { kennelId: kennel.id },
    select: {
      id: true,
      date: true,
      runNumber: true,
      title: true,
      status: true,
      adminCancelledAt: true,
      rawEvents: { select: { id: true } },
      attendances: { select: { id: true } },
    },
    orderBy: [{ date: "asc" }, { runNumber: "asc" }],
  });

  const toDelete: Candidate[] = [...findOrphans(events), ...findDuplicates(events)];

  if (toDelete.length === 0) {
    console.log("\nNothing to delete — prod is clean.");
    return;
  }

  console.log(`\n${toDelete.length} canonical Event(s) flagged for deletion:`);
  for (const c of toDelete) {
    console.log(`  ${c.date}  #${c.runNumber}  ${JSON.stringify(c.title)}  — ${c.reason}  [${c.id}]`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — set CLEANUP_APPLY=1 to delete.");
    return;
  }

  const ids = toDelete.map((c) => c.id);
  await prisma.$transaction(async (tx) => {
    await tx.eventLink.deleteMany({ where: { eventId: { in: ids } } });
    const del = await tx.event.deleteMany({ where: { id: { in: ids } } });
    console.log(`\nDeleted ${del.count} Event(s) (EventKennel cascaded).`);
  });

  // Post-delete orphan check.
  const remaining = await prisma.event.count({
    where: { kennelId: kennel.id, status: "CANCELLED", rawEvents: { none: {} }, adminCancelledAt: null },
  });
  console.log(`Remaining source-less cancelled mh3-de Events: ${remaining}`);
}

main().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
