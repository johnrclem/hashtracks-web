/**
 * Live-verified guarded cleanup for Pedal Files (`pedalfiles`) — issue #1990.
 *
 * BACKGROUND / NOT-REPRODUCIBLE FINDING
 * -------------------------------------
 * #1990 claimed 4 "admin-seeded forward events" (2026-05-17 / 06-21 / 07-19 /
 * 08-16, all titled "Bash") were on HashTracks but NOT in the source calendar,
 * and recommended dropping them as seed-then-scrape orphans.
 *
 * Prod verification (2026-06-07) overturned that:
 *   - All four prod Events carry a real GCal `sourceUrl`
 *     (`…/event?eid=…tucsonhhh@m`) AND multiple RawEvents.
 *   - Decoding the eids, all four share ONE recurring-master id
 *     (`1u5eejnfgjgehgb8mc95e7lkrk_YYYYMMDDT170000Z`) — they are RRULE
 *     recurrence instances, not seeds.
 *   - The live Calendar API (singleEvents=true) returns all four (plus 2026-09-20)
 *     as recurring "Bash - tbd" events.
 * The issue enumerated raw `basic.ics` VEVENTs, which do NOT expand RRULEs — hence
 * the false "not in source" read. Deleting these would be wrong: the next scrape
 * re-creates them. (memory: feedback_verify_prod_before_audit_cleanup,
 * feedback_audit_adapter_bug_often_self_healed.)
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Rather than hard-code that conclusion, it re-derives it safely every run:
 *   1. Enumerate the LIVE source event dates via the GCal adapter (read-only,
 *      days=9999 — same set the merge pipeline sees).
 *   2. Classify every `pedalfiles` Event. A deletable orphan must be ALL of:
 *        (a) `sourceUrl` is null  AND
 *        (b) zero RawEvents (true seed-only provenance)  AND
 *        (c) its date is absent from the live source set.
 *   3. Delete only those, via the race-safe `deleteLeakedEvent` helper (refuses
 *      if any Attendance / KennelAttendance / EventHare exists), then recompute
 *      `Kennel.lastEventDate`.
 *
 * Given current prod, NO event satisfies (a)+(b)+(c) → the script deletes nothing
 * and prints the provenance of every event so the not-reproducible finding is
 * auditable. If the kennel's situation ever changes, the same guard does the
 * right thing without edits.
 *
 * Usage (dry-run is the default and is safe against any DB):
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a            # GOOGLE_CALENDAR_API_KEY + prod DATABASE_URL
 *   npx tsx scripts/cleanup-pedalfiles-seed-forward.ts            # dry-run
 *   npx tsx scripts/cleanup-pedalfiles-seed-forward.ts --execute  # apply
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getAdapter } from "@/adapters/registry";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { createScriptPool } from "./lib/db-pool";
import { deleteLeakedEvent } from "./lib/delete-leaked-event";

const EXECUTE = process.argv.includes("--execute");
const KENNEL_CODE = "pedalfiles";
const SOURCE_NAME = "Pedal Files Bash Google Calendar";
// Wide window so the live source enumeration covers the full archive + the
// 365-day future horizon the adapter caps at.
const SCRAPE_DAYS = 9999;

/** Event.date is stored as UTC noon — render the calendar date in UTC. */
function toUtcDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — `set -a && source .env` first.");
  }
  console.log(`\n=== cleanup-pedalfiles-seed-forward ===`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will delete confirmed orphans)" : "DRY-RUN (read-only)"}\n`);

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const kennel = await prisma.kennel.findUnique({ where: { kennelCode: KENNEL_CODE } });
    if (!kennel) throw new Error(`Kennel "${KENNEL_CODE}" not found.`);

    const source = await prisma.source.findFirst({ where: { name: SOURCE_NAME } });
    if (!source) throw new Error(`Source "${SOURCE_NAME}" not found.`);

    // 1. Enumerate the LIVE source dates (read-only adapter use).
    const adapter = getAdapter(source.type, source.url, source.config as Record<string, unknown> | null);
    const result = await adapter.fetch(source, { days: SCRAPE_DAYS });
    const liveDates = new Set(result.events.map((e) => e.date));
    const sortedDates = [...liveDates].sort((a, b) => a.localeCompare(b));
    console.log(
      `Live source: ${result.events.length} event(s); date range ` +
        `${sortedDates[0] ?? "—"} → ${sortedDates.at(-1) ?? "—"}\n`,
    );

    // 2. Classify every pedalfiles Event by provenance + live presence.
    const events = await prisma.event.findMany({
      where: { kennelId: kennel.id },
      select: {
        id: true,
        date: true,
        title: true,
        sourceUrl: true,
        _count: { select: { rawEvents: true, attendances: true, kennelAttendances: true, hares: true } },
      },
      orderBy: { date: "asc" },
    });

    const orphans: typeof events = [];
    console.log(`Pedal Files events (${events.length}):`);
    for (const e of events) {
      const dateStr = toUtcDateStr(e.date);
      const inLive = liveDates.has(dateStr);
      const seedOnly = e.sourceUrl === null && e._count.rawEvents === 0;
      const isOrphan = seedOnly && !inLive;
      if (isOrphan) orphans.push(e);
      console.log(
        `  ${dateStr}  ${isOrphan ? "ORPHAN " : "keep   "}` +
          `sourceUrl=${e.sourceUrl ? "yes" : "no"} raws=${e._count.rawEvents} ` +
          `inLiveSource=${inLive ? "yes" : "no"} ` +
          `att=${e._count.attendances} ka=${e._count.kennelAttendances} hares=${e._count.hares}  "${e.title}"`,
      );
    }

    if (orphans.length === 0) {
      console.log(
        `\nNo deletable orphans — every event is either source-backed (sourceUrl/RawEvents) ` +
          `or still present in the live calendar. #1990 is not reproducible; nothing to delete.`,
      );
      return;
    }

    console.log(`\nFound ${orphans.length} confirmed orphan(s) (no sourceUrl, no RawEvents, absent from live source).`);
    if (!EXECUTE) {
      console.log(`Dry-run — re-run with --execute to delete.`);
      return;
    }

    // 3. Race-safe delete; refuse any orphan that has accrued user data.
    let deleted = 0;
    for (const e of orphans) {
      await deleteLeakedEvent(prisma, e.id, ["attendances", "kennelAttendances", "hares"]);
      deleted++;
    }
    console.log(`\nDeleted ${deleted} orphan event(s).`);

    const refreshed = await backfillLastEventDates();
    console.log(`Recomputed lastEventDate (${refreshed} kennel row(s) updated).`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
