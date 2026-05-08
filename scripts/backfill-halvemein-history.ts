/**
 * Partial historical backfill for Halve Mein (`halvemein`, Capital District NY).
 * Issue #1249.
 *
 * The kennel's archive at `https://www.hmhhh.com/index.php?log=previous.con`
 * lists 824 historical runs but **has no date column** — only:
 *   Run No. | No @ Run | What | Hare | FRB | DAL | Hash-it | Hash-Trash
 *
 * A 26-year backward extrapolation off a biweekly cadence with un-flagged
 * special weekends is not safe enough to ship for the full archive — drift
 * accumulates and the canonical Event schema has no "date is approximate"
 * marker. So this is a deliberately scoped *partial* backfill: only runs
 * close enough to a known-date anchor in the live feed get inserted.
 *
 * Algorithm:
 *   1. Fetch + parse `previous.con`.
 *   2. Query DB for canonical `Event` rows on kennel `halvemein` with
 *      `runNumber` set. The HIGHEST such runNumber is our anchor.
 *   3. For each archive row whose runNumber is NOT already in DB AND whose
 *      offset to the anchor is in [1, MAX_BACKWARDS_RUNS] (default 50):
 *        derivedDate = anchor.date − (anchor.runNumber − row.runNumber) × 14 days
 *   4. Skip everything else (already in DB or beyond the confidence window).
 *   5. `reportAndApplyBackfill` partitions to date < today (America/New_York)
 *      and routes through the merge pipeline (fingerprint dedup → idempotent).
 *
 * Why anchor on the HIGHEST runNumber:
 *   The earlier draft anchored on the lowest runNumber, but that drifts
 *   downward every time this backfill runs (the newly-inserted runs become
 *   the new minimum), causing run-2 to emit another 50 older runs and
 *   breaking idempotency (Codex review #1305). Highest-runNumber is stable:
 *   live ingest only adds higher numbers, and this backfill never emits any
 *   row with runNumber ≥ anchor (offset > 0 guard), so the anchor only
 *   moves forward when the live feed advances. Combined with the
 *   existing-run-number skip, that bounds drift on any re-emission to one
 *   cadence step (~14 days), well within the partial-backfill error budget.
 *
 * Why ±14 days:
 *   The kennel runs every other Wednesday year-round. Special-weekend events
 *   (campouts, away weekends) shift dates inside the cadence but not the run
 *   counter — within a 50-run / ~700-day window from the anchor, drift stays
 *   below ~2 weeks for the vast majority of runs. The 50-run cap is the knob
 *   that keeps drift bounded; widen it only if a kennel-provided CSV becomes
 *   available (issue #1249, suggested fix path 3).
 *
 * Idempotency:
 *   Anchor is chosen deterministically (highest runNumber + date in DB), the
 *   walk is deterministic, and existing DB runNumbers are filtered out before
 *   emission. Re-running this script writes zero new rows.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-halvemein-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-halvemein-history.ts
 *   Env:       DATABASE_URL
 *   Tunable:   BACKFILL_MAX_BACKWARDS_RUNS=50 (default)
 */

import "dotenv/config";
import * as cheerio from "cheerio";
import { runBackfillScript } from "./lib/backfill-runner";
import { prisma } from "@/lib/db";
import { safeFetch } from "@/adapters/safe-fetch";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Halve Mein Website";
const KENNEL_CODE = "halvemein";
const KENNEL_TIMEZONE = "America/New_York";
const ARCHIVE_URL = "https://www.hmhhh.com/index.php?log=previous.con";
const USER_AGENT = "Mozilla/5.0 (compatible; HashTracks-Backfill)";
const CADENCE_DAYS = 14;
const DEFAULT_MAX_BACKWARDS_RUNS = 50;

interface ArchiveRow {
  runNumber: number;
  title?: string;
  hares?: string;
}

/**
 * The page has a few chrome tables for layout/nav; the archive table is
 * identified by its first `<th>` containing "Run No." rather than document
 * position. The page also ships malformed HTML in places (e.g. `824/td>`
 * instead of `824</td>`), but cheerio recovers the cell text either way.
 */
function parseArchive(html: string): ArchiveRow[] {
  const $ = cheerio.load(html);
  const rows: ArchiveRow[] = [];

  const archiveTable = $("table")
    .toArray()
    .find((t) => $(t).find("th").first().text().toLowerCase().includes("run no"));
  if (!archiveTable) return rows;

  $(archiveTable)
    .find("tr")
    .each((_i, tr) => {
      const cells = $(tr)
        .find("td")
        .toArray()
        .map((td) => $(td).text().trim());
      if (cells.length < 2) return;

      const runText = cells[0]?.replace(/[^\d]/g, "") ?? "";
      if (!runText) return;
      const runNumber = Number.parseInt(runText, 10);
      if (!Number.isFinite(runNumber) || runNumber <= 0) return;

      const title = cells[2]?.trim() || undefined;
      const hares = cells[3]?.trim() || undefined;
      rows.push({
        runNumber,
        ...(title && { title }),
        ...(hares && { hares }),
      });
    });

  return rows;
}

interface Anchor {
  runNumber: number;
  /** Date as YYYY-MM-DD in UTC (Event.date is stored as UTC noon). */
  date: string;
}

function shiftDateByDays(iso: string, deltaDays: number): string {
  const [y, m, d] = iso.split("-").map((s) => Number.parseInt(s, 10));
  const out = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, "0")}-${String(out.getUTCDate()).padStart(2, "0")}`;
}

function buildTitle(row: ArchiveRow): string {
  if (row.title && row.title !== "Hash") {
    return `HMHHH #${row.runNumber}: ${row.title}`;
  }
  return `HMHHH #${row.runNumber}`;
}

function resolveMaxBackwards(): number {
  const raw = process.env.BACKFILL_MAX_BACKWARDS_RUNS;
  if (raw == null || raw === "") return DEFAULT_MAX_BACKWARDS_RUNS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid BACKFILL_MAX_BACKWARDS_RUNS: "${raw}". Must be a positive integer.`,
    );
  }
  return parsed;
}

async function fetchEvents(): Promise<RawEventData[]> {
  const maxBackwards = resolveMaxBackwards();

  console.log(`Fetching archive: ${ARCHIVE_URL}`);
  const res = await safeFetch(ARCHIVE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Archive fetch failed: HTTP ${res.status}`);
  }
  const html = await res.text();
  const archive = parseArchive(html);
  console.log(`  Parsed ${archive.length} archive rows.`);

  console.log("\nResolving anchor + existing run numbers...");
  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true },
  });
  if (!kennel) {
    throw new Error(`Kennel "${KENNEL_CODE}" not found in DB.`);
  }
  // Highest-runNumber anchor must come from canonical rows only — when two
  // sources disagree on (kennelId, date) the merge pipeline keeps every row
  // for audit but only flags one canonical. Anchoring on a non-canonical
  // duplicate would let stale dates leak into derived dates.
  const dbEvents = await prisma.event.findMany({
    where: { kennelId: kennel.id, runNumber: { not: null }, isCanonical: true },
    orderBy: { runNumber: "desc" },
    select: { runNumber: true, date: true },
  });
  const existingRuns = new Set(
    dbEvents
      .map((e) => e.runNumber)
      .filter((n): n is number => n != null),
  );
  const anchorRow = dbEvents[0];
  if (anchorRow?.runNumber == null) {
    console.warn(
      "  No live event with runNumber + date found for halvemein. " +
        "Run the live scrape first to seed at least one anchor, then re-run this script.",
    );
    return [];
  }
  const anchor: Anchor = {
    runNumber: anchorRow.runNumber,
    date: anchorRow.date.toISOString().slice(0, 10),
  };
  console.log(`  Anchor: run #${anchor.runNumber} on ${anchor.date} (highest in DB)`);
  console.log(`  ${existingRuns.size} runs already in DB (will be skipped).`);
  console.log(`  Window: max ${maxBackwards} runs back from anchor.`);

  const events: RawEventData[] = [];
  let skipExisting = 0;
  let skipOutOfWindow = 0;
  let skipBeyondAnchor = 0;

  for (const row of archive) {
    if (existingRuns.has(row.runNumber)) {
      skipExisting++;
      continue;
    }
    const offset = anchor.runNumber - row.runNumber;
    if (offset <= 0) {
      skipBeyondAnchor++;
      continue;
    }
    if (offset > maxBackwards) {
      skipOutOfWindow++;
      continue;
    }

    const date = shiftDateByDays(anchor.date, -offset * CADENCE_DAYS);
    events.push({
      date,
      kennelTags: [KENNEL_CODE],
      runNumber: row.runNumber,
      title: buildTitle(row),
      sourceUrl: ARCHIVE_URL,
      ...(row.hares && { hares: row.hares }),
    });
  }

  console.log(
    `  Emitting ${events.length} events. Skipped: ${skipExisting} already in DB, ` +
      `${skipOutOfWindow} beyond ${maxBackwards}-run window, ${skipBeyondAnchor} newer-than-anchor.`,
  );
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking Halve Mein archive (date-derived from anchor)",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
