/**
 * One-shot cleanup for the phantom-date duplicate cohort (#1613 MarinH3,
 * #1643 OFH3, #1648 Narwhal H3).
 *
 * Root cause (fixed in this PR's `src/pipeline/merge.ts` change): the merge
 * pipeline keyed canonical-Event lookup on `(kennelId, date)` only, so when
 * a source corrected an event's date the old canonical Event survived
 * alongside the new one — both pointing at the same `sourceUrl`. This
 * script resolves the existing pre-fix duplicate cohort by deleting the
 * stale half of each pair.
 *
 * Discovery: self-join on `Event.sourceUrl` constrained to a single kennel
 * via `EventKennel`, with `|date_a - date_b| ≤ N days`. Confined to the
 * three affected kennels by kennelCode whitelist so this script can never
 * misfire on unrelated data.
 *
 * Resolution policy (locked):
 *   - Keep the Event whose linked RawEvent set has the most-recent
 *     `scrapedAt` (latest scrape = source's current truth).
 *   - **Attendance preflight**: if the losing Event has any Attendance or
 *     KennelAttendance rows the script aborts with a listing — misman
 *     attendance loss is unrecoverable, so a human must reassign before
 *     this script can clean.
 *   - Cascade-delete the loser via `cascadeDeleteEvents` (preserves
 *     RawEvents via `eventId=null, processed=false` so the audit trail
 *     survives and the merge pipeline will re-link them to the winner on
 *     the next scrape).
 *
 * Dry-run by default; pass `--apply` to write.
 *   npm run tsx scripts/cleanup-phantom-date-duplicates.ts           # preview
 *   npm run tsx scripts/cleanup-phantom-date-duplicates.ts -- --apply
 */
import "dotenv/config";
import { Prisma } from "../src/generated/prisma/client";
import { prisma } from "../src/lib/db";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const APPLY = process.argv.includes("--apply");

// Must match SAME_SOURCE_URL_DEDUP_WINDOW_DAYS in src/pipeline/merge.ts —
// using the same window means the cleanup catches exactly what the merge
// fix would have caught had it been live for the original scrapes.
const WINDOW_DAYS = 30;

// Whitelist scope: only the three kennels in the audited issues. Adding a
// kennel here without explicit issue tracking would risk merging legitimate
// distinct events that happen to share a sourceUrl (rare but possible —
// e.g. an iCal feed with one master URL per recurring run).
const AFFECTED_KENNEL_CODES = ["marinh3", "ofh3", "narwhal-h3"] as const;

/**
 * Explicit-purge list: phantom-date pairs that the auto-discovery query
 * misses, captured from issue bodies. Each entry deletes the named loser
 * Event with the same attendance preflight as the auto path.
 *
 * Why these are listed manually rather than discovered:
 *  - **Narwhal H3 #1648**: Meetup assigned the rescheduled event a new
 *    eventId, so the two canonical Events carry distinct sourceUrls.
 *    The merge.ts fix only matches identical sourceUrls (correct — distinct
 *    URLs imply distinct events per the platform's data model). Cleanup
 *    can only be one-shot.
 *  - **OFH3 #1643**: The phantom currently has no sibling at the correct
 *    date — it stands alone at 2026-06-01. Once the adapter year-anchor
 *    fix re-scrapes, a new canonical at 2025-06-01 would appear, but the
 *    365-day gap exceeds the ±30d auto-discovery window. Easier to delete
 *    the 2026 phantom outright now.
 */
const NAMED_PHANTOMS: { issue: number; kennelCode: string; loserId: string; reason: string }[] = [
  {
    issue: 1648,
    kennelCode: "narwhal-h3",
    loserId: "cmmobywzg000f04i8df6ls0zi",
    reason: "Wrong-weekday (Wed Jun 21 2023) duplicate of Sun Jun 25 trail #53; distinct Meetup eventId",
  },
  {
    issue: 1643,
    kennelCode: "ofh3",
    loserId: "cmm3khyet000804jr5t5rr629",
    reason: "2025 blog post mapped to 2026-06-01 by pre-fix chrono — year-anchor adapter fix re-scrapes correctly to 2025-06-01",
  },
];

interface PairRow {
  a_id: string;
  a_date: Date;
  a_source_url: string;
  b_id: string;
  b_date: Date;
  kennel_code: string;
}

interface ScanRow {
  id: string;
  date: Date;
  sourceUrl: string | null;
  title: string | null;
  trustLevel: number;
  attendanceCount: number;
  kennelAttendanceCount: number;
  latestScrapedAt: Date | null;
  status: string;
}

async function findPhantomPairs(): Promise<PairRow[]> {
  // Self-join via EventKennel keeps the kennel scope tight. `b.id > a.id`
  // canonicalizes pair ordering so a 3-way phantom cluster reports as
  // (a,b) + (a,c) + (b,c) without double-counting in reverse.
  return prisma.$queryRaw<PairRow[]>`
    SELECT
      a.id           AS a_id,
      a.date         AS a_date,
      a."sourceUrl"  AS a_source_url,
      b.id           AS b_id,
      b.date         AS b_date,
      k."kennelCode" AS kennel_code
    FROM "Event" a
    JOIN "Event" b
      ON b."sourceUrl" = a."sourceUrl"
      AND b.id > a.id
      AND ABS(EXTRACT(EPOCH FROM (b.date - a.date))) <= ${WINDOW_DAYS * 86400}
      AND b.date <> a.date
    JOIN "EventKennel" ka ON ka."eventId" = a.id
    JOIN "EventKennel" kb ON kb."eventId" = b.id AND kb."kennelId" = ka."kennelId"
    JOIN "Kennel" k       ON k.id = ka."kennelId"
    WHERE k."kennelCode" IN (${Prisma.join([...AFFECTED_KENNEL_CODES])})
      AND a."sourceUrl" IS NOT NULL AND a."sourceUrl" <> ''
      AND a.status <> 'CANCELLED' AND b.status <> 'CANCELLED'
      AND a."parentEventId" IS NULL AND b."parentEventId" IS NULL
      AND a."isSeriesParent" = false AND b."isSeriesParent" = false
    ORDER BY k."kennelCode", a."sourceUrl", a.date;
  `;
}

async function inspectEvent(id: string): Promise<ScanRow> {
  const event = await prisma.event.findUniqueOrThrow({
    where: { id },
    select: {
      id: true,
      date: true,
      sourceUrl: true,
      title: true,
      trustLevel: true,
      status: true,
      _count: {
        select: { attendances: true, kennelAttendances: true },
      },
      rawEvents: {
        select: { scrapedAt: true },
        orderBy: { scrapedAt: "desc" },
        take: 1,
      },
    },
  });
  return {
    id: event.id,
    date: event.date,
    sourceUrl: event.sourceUrl,
    title: event.title,
    trustLevel: event.trustLevel,
    attendanceCount: event._count.attendances,
    kennelAttendanceCount: event._count.kennelAttendances,
    latestScrapedAt: event.rawEvents[0]?.scrapedAt ?? null,
    status: event.status,
  };
}

function pickWinnerLoser(a: ScanRow, b: ScanRow): { winner: ScanRow; loser: ScanRow } {
  // Most-recent linked-RawEvent scrape wins — that's the version the source
  // currently affirms. Ties (or both null) → keep the higher-trust row;
  // ties on trust → keep the larger date (later corrections typically
  // reflect the realized run date for late-finalizing sources).
  const aMs = a.latestScrapedAt?.getTime() ?? 0;
  const bMs = b.latestScrapedAt?.getTime() ?? 0;
  if (aMs !== bMs) return aMs > bMs ? { winner: a, loser: b } : { winner: b, loser: a };
  if (a.trustLevel !== b.trustLevel) {
    return a.trustLevel > b.trustLevel ? { winner: a, loser: b } : { winner: b, loser: a };
  }
  return a.date.getTime() > b.date.getTime() ? { winner: a, loser: b } : { winner: b, loser: a };
}

interface CleanupState {
  lossesById: Map<string, ScanRow>;
  winsById: Map<string, ScanRow>;
  blockingAttendance: { event: ScanRow; pair: PairRow }[];
}

function fmtScanRow(e: ScanRow): string {
  return `${e.id} date=${e.date.toISOString().slice(0, 10)} trust=${e.trustLevel} ` +
    `att=${e.attendanceCount}+${e.kennelAttendanceCount} ` +
    `lastScrape=${e.latestScrapedAt?.toISOString() ?? "<none>"} ` +
    `title=${JSON.stringify(e.title)}`;
}

async function ingestAutoPairs(pairs: PairRow[], state: CleanupState): Promise<void> {
  for (const pair of pairs) {
    const [a, b] = await Promise.all([inspectEvent(pair.a_id), inspectEvent(pair.b_id)]);
    const { winner, loser } = pickWinnerLoser(a, b);

    if (loser.attendanceCount + loser.kennelAttendanceCount > 0) {
      state.blockingAttendance.push({ event: loser, pair });
    }
    if (!state.lossesById.has(loser.id)) state.lossesById.set(loser.id, loser);
    if (!state.winsById.has(winner.id)) state.winsById.set(winner.id, winner);

    console.log(
      `[${pair.kennel_code}] sourceUrl=${pair.a_source_url}\n` +
      `  KEEP : ${fmtScanRow(winner)}\n` +
      `  DROP : ${fmtScanRow(loser)}\n`,
    );
  }
}

async function ingestNamedPhantoms(state: CleanupState): Promise<void> {
  if (NAMED_PHANTOMS.length === 0) return;
  console.log(`\nNamed-phantom purges (${NAMED_PHANTOMS.length}):`);
  for (const entry of NAMED_PHANTOMS) {
    const exists = await prisma.event.findUnique({
      where: { id: entry.loserId },
      select: { id: true },
    });
    if (!exists) {
      console.log(`  [#${entry.issue} ${entry.kennelCode}] ${entry.loserId}  ALREADY CLEANED — skip`);
      continue;
    }
    const ev = await inspectEvent(entry.loserId);
    if (ev.attendanceCount + ev.kennelAttendanceCount > 0) {
      // Synthesize a PairRow-shaped record so the attendance-error block
      // can print one consistent format for both auto and named entries.
      state.blockingAttendance.push({
        event: ev,
        pair: {
          a_id: ev.id, a_date: ev.date,
          a_source_url: ev.sourceUrl ?? "(named)",
          b_id: "(named-purge)", b_date: ev.date,
          kennel_code: entry.kennelCode,
        },
      });
    }
    if (!state.lossesById.has(ev.id)) state.lossesById.set(ev.id, ev);
    console.log(
      `  [#${entry.issue} ${entry.kennelCode}] ${entry.reason}\n` +
      `    DROP : ${fmtScanRow(ev)}`,
    );
  }
}

function reportAttendanceBlocks(blocks: { event: ScanRow; pair: PairRow }[]): void {
  console.error(
    `\nABORT: ${blocks.length} losing Event(s) carry attendance rows. ` +
    `Reassign attendance to the surviving canonical (via misman or admin tools) ` +
    `before re-running this cleanup. Affected:`,
  );
  for (const { event, pair } of blocks) {
    console.error(
      `  ${pair.kennel_code} eventId=${event.id} date=${event.date.toISOString().slice(0, 10)} ` +
      `attendance=${event.attendanceCount} kennelAttendance=${event.kennelAttendanceCount}`,
    );
  }
}

function findWinnerLoserCollision(state: CleanupState): string | null {
  for (const id of state.lossesById.keys()) {
    if (state.winsById.has(id)) return id;
  }
  return null;
}

async function main() {
  const pairs = await findPhantomPairs();
  console.log(`Mode: ${APPLY ? "APPLY (writing to prod)" : "DRY RUN"}`);
  console.log(`Found ${pairs.length} candidate phantom-date pair(s) within ±${WINDOW_DAYS} days.\n`);

  if (pairs.length === 0 && NAMED_PHANTOMS.length === 0) {
    console.log("Nothing to clean.");
    await prisma.$disconnect();
    return;
  }

  const state: CleanupState = {
    lossesById: new Map(),
    winsById: new Map(),
    blockingAttendance: [],
  };

  await ingestAutoPairs(pairs, state);
  await ingestNamedPhantoms(state);

  if (state.blockingAttendance.length > 0) {
    reportAttendanceBlocks(state.blockingAttendance);
    await prisma.$disconnect();
    process.exit(1);
  }

  const collision = findWinnerLoserCollision(state);
  if (collision !== null) {
    console.error(`ABORT: event ${collision} is both a winner and a loser across pairs. Aborting to avoid data loss.`);
    await prisma.$disconnect();
    process.exit(1);
  }

  if (!APPLY) {
    console.log(`\nDry-run only — ${state.lossesById.size} Event(s) would be cascade-deleted.`);
    console.log("Re-run with --apply to write changes.");
    await prisma.$disconnect();
    return;
  }

  const deleted = await cascadeDeleteEvents(prisma, [...state.lossesById.keys()]);
  console.log(`\nDeleted ${deleted} Event row(s) (dependents removed, RawEvent history unlinked).`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
