/**
 * One-off cleanup for PR #973 stranded future events.
 *
 * PR #973 capped the GOOGLE_CALENDAR adapter's future scrape window at 365 days.
 * Events ingested BEFORE the cap, with dates as far out as 2034, are now
 * "stranded" — the reconcile pipeline won't prune them because they fall outside
 * its rolling window, yet they'll never be refreshed because the adapter won't
 * fetch that far ahead anymore.
 *
 * Targets: CONFIRMED, canonical Events dated >= 2027-01-01 for the kennels fed
 * by the Chicagoland Hash Calendar (and NOH3 — same unbounded-window pattern).
 *
 * On --execute, uses the same cascade-safe delete semantics as bulkDeleteEvents():
 *   1. Unlink RawEvents (preserve immutable audit trail, reset processed=false)
 *   2. Null out parentEventId back-refs (avoid FK violations)
 *   3. Delete EventHare, Attendance, KennelAttendance rows for the events
 *   4. Delete the Event rows (EventLink cascades via onDelete: Cascade)
 * Processes in batches of 100 and caps at 5000 deletes per kennel, matching the
 * admin safety limit in src/app/admin/events/actions.ts.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-stale-future-events-973.ts           # dry-run (default)
 *   npx tsx scripts/cleanup-stale-future-events-973.ts --execute # actually delete
 *
 * IMPORTANT: .env must point at Railway prod for deletions to take effect.
 * Dry-run is always safe against any DB and prints counts without writing.
 *
 * Run dry-run first, verify counts look reasonable, then re-run with --execute.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const EXECUTE = process.argv.includes("--execute");
// Stale threshold: events dated on or after this date are candidates.
// 2027-01-01 gives ~365 days of headroom from today (2026-04-27) and
// clearly separates legitimate upcoming events from the stranded far-future ones.
const STALE_FROM = new Date("2027-01-01T00:00:00.000Z");
const BATCH_SIZE = 100;
const DELETE_CAP = 5000;

// Kennels fed by the Chicagoland Hash Calendar (Google Calendar, unbounded pre-#973)
// plus NOH3 (separate calendar, same issue). kennelCode must match Kennel.kennelCode
// exactly — the script skips unknown codes rather than aborting.
const AFFECTED_KENNEL_CODES = [
  "ch3",     // Chicago H3 (Chicago Hash House Harriers)
  "th3",     // Thirstday H3 (Thirstday Hash House Harriers)
  "cfmh3",   // CFMH3 (Chicago Full Moon Hash House Harriers)
  "fcmh3",   // FCMH3 (First Crack of the Moon Hash House Harriers)
  "bdh3",    // Big Dogs H3 (Big Dogs Hash House Harriers)
  "bmh3",    // Bushman H3 (Bushman Hash House Harriers — Chicago)
  "2ch3",    // 2CH3 (Second City Hash House Harriers)
  "wwh3",    // Whiskey Wed H3 (Whiskey Wednesday Hash House Harriers)
  "4x2h4",   // 4X2H4 (4x2 Hash House Harriers and Harriettes)
  "rth3",    // Ragtime H3 (Ragtime Hash House Harriers)
  "dlh3",    // DLH3 (Duneland Hash House Harriers — South Shore, IN)
  "c2b3h4",  // C2B3H4 (Chicago Ballbuster Hash House Harriers — added in #973)
  "noh3",    // NOH3 (New Orleans Hash House Harriers — separate calendar, same unbounded-window issue)
] as const;

interface KennelResult {
  kennelCode: string;
  shortName: string;
  totalStale: number;
  withAttendance: number;
  minDate: string | null;
  maxDate: string | null;
  deleted: number;
  cappedAt: number | null;
  error: string | null;
}

async function processKennel(
  prisma: PrismaClient,
  kennelCode: string,
): Promise<KennelResult> {
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode },
    select: { id: true, shortName: true },
  });

  if (!kennel) {
    return {
      kennelCode,
      shortName: "(not found)",
      totalStale: 0,
      withAttendance: 0,
      minDate: null,
      maxDate: null,
      deleted: 0,
      cappedAt: null,
      error: "kennel not found in DB — skipped",
    };
  }

  const staleWhere = {
    kennelId: kennel.id,
    date: { gte: STALE_FROM },
    status: "CONFIRMED" as const,
    isCanonical: true,
  };

  const [totalStale, withAttendance, dateRange] = await Promise.all([
    prisma.event.count({ where: staleWhere }),
    prisma.event.count({
      where: { ...staleWhere, attendances: { some: {} } },
    }),
    prisma.event.aggregate({
      where: staleWhere,
      _min: { date: true },
      _max: { date: true },
    }),
  ]);

  const minDate = dateRange._min.date?.toISOString().split("T")[0] ?? null;
  const maxDate = dateRange._max.date?.toISOString().split("T")[0] ?? null;

  if (totalStale === 0) {
    return {
      kennelCode,
      shortName: kennel.shortName,
      totalStale: 0,
      withAttendance: 0,
      minDate: null,
      maxDate: null,
      deleted: 0,
      cappedAt: null,
      error: null,
    };
  }

  if (!EXECUTE) {
    return {
      kennelCode,
      shortName: kennel.shortName,
      totalStale,
      withAttendance,
      minDate,
      maxDate,
      deleted: 0,
      cappedAt: totalStale > DELETE_CAP ? DELETE_CAP : null,
      error: null,
    };
  }

  // Execute mode: fetch IDs and delete (capped at DELETE_CAP)
  const events = await prisma.event.findMany({
    where: staleWhere,
    select: { id: true },
    orderBy: { date: "asc" },
    take: DELETE_CAP,
  });

  const cappedAt = totalStale > DELETE_CAP ? DELETE_CAP : null;

  let deleted = 0;
  let error: string | null = null;
  try {
    deleted = await cascadeDeleteEvents(prisma, events.map((e) => e.id));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  return {
    kennelCode,
    shortName: kennel.shortName,
    totalStale,
    withAttendance,
    minDate,
    maxDate,
    deleted,
    cappedAt,
    error,
  };
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function printTable(results: KennelResult[]) {
  const COL = { code: 14, name: 28, total: 7, attn: 5, range: 23, deleted: 9, notes: 40 };
  const header =
    pad("kennelCode", COL.code) +
    pad("shortName", COL.name) +
    pad("stale", COL.total) +
    pad("attn", COL.attn) +
    pad("date range", COL.range) +
    (EXECUTE ? pad("deleted", COL.deleted) : "") +
    "notes";
  const sep = "-".repeat(header.length);

  console.log("\n" + sep);
  console.log(header);
  console.log(sep);

  let grandTotal = 0;
  let grandDeleted = 0;
  let grandAttendance = 0;

  for (const r of results) {
    grandTotal += r.totalStale;
    grandDeleted += r.deleted;
    grandAttendance += r.withAttendance;

    let notes = "";
    if (r.error) notes = `ERROR: ${r.error}`;
    else if (r.totalStale === 0) notes = "(no stale events)";
    else if (r.cappedAt !== null) notes = `capped at ${r.cappedAt} (${r.totalStale} total)`;
    else if (r.withAttendance > 0) notes = `⚠️  ${r.withAttendance} have Attendance records`;

    const range =
      r.minDate && r.maxDate
        ? `${r.minDate} → ${r.maxDate}`
        : "—";

    const row =
      pad(r.kennelCode, COL.code) +
      pad(r.shortName.slice(0, COL.name - 1), COL.name) +
      pad(r.totalStale > 0 ? String(r.totalStale) : "—", COL.total) +
      pad(r.withAttendance > 0 ? String(r.withAttendance) : "—", COL.attn) +
      pad(range, COL.range) +
      (EXECUTE ? pad(r.deleted > 0 ? String(r.deleted) : "—", COL.deleted) : "") +
      notes;

    console.log(row);
  }

  console.log(sep);
  const summaryRow =
    pad("TOTAL", COL.code) +
    pad("", COL.name) +
    pad(String(grandTotal), COL.total) +
    pad(grandAttendance > 0 ? String(grandAttendance) : "—", COL.attn) +
    pad("", COL.range) +
    (EXECUTE ? pad(String(grandDeleted), COL.deleted) : "");
  console.log(summaryRow);
  console.log(sep + "\n");
}

async function main() {
  const mode = EXECUTE ? "EXECUTE (will delete from DB)" : "DRY-RUN (read-only, no changes)";
  console.log(`\n=== cleanup-stale-future-events-973 ===`);
  console.log(`Mode: ${mode}`);
  console.log(`Stale threshold: events dated >= ${STALE_FROM.toISOString().split("T")[0]}`);
  console.log(`Delete cap per kennel: ${DELETE_CAP}`);
  console.log(`Kennels: ${AFFECTED_KENNEL_CODES.join(", ")}\n`);

  if (EXECUTE) {
    console.log("⚠️  EXECUTE MODE ACTIVE — DB writes will occur. Press Ctrl-C within 3s to abort.");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("Proceeding...\n");
  }

  const pool = createScriptPool();
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) } as never);

  try {
    const results: KennelResult[] = [];
    for (const code of AFFECTED_KENNEL_CODES) {
      process.stdout.write(`  Processing ${code}...`);
      const result = await processKennel(prisma, code);
      results.push(result);
      process.stdout.write(
        result.totalStale === 0
          ? " (none)\n"
          : ` ${result.totalStale} stale${EXECUTE ? `, deleted ${result.deleted}` : ""}\n`,
      );
    }

    printTable(results);

    if (!EXECUTE) {
      console.log("Dry-run complete. Re-run with --execute to delete.");
      console.log("Verify all kennels with Attendance records (⚠️) before executing.");
    } else {
      const total = results.reduce((s, r) => s + r.deleted, 0);
      console.log(`Done. Deleted ${total} events total.`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error("\nFatal error:", err);
  process.exit(1);
});
