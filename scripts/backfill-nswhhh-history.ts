/**
 * One-shot historical backfill for North Shore Wanderers H3 (NSWHHH, Sydney).
 *
 * The live GOOGLE_SHEETS source scrapes the *forward* hareline tab (gid=0,
 * upcomingOnly). The same workbook has a clean historical archive tab
 * (gid=360703890) carrying ~180 numbered runs back to Sep 2022 (#904), which
 * the forward source never sees. This script reads that archive, keeps only
 * numbered runs dated before today, and routes them through the live merge
 * pipeline (idempotent — `processRawEvents` dedupes by fingerprint).
 *
 * Bound to the same Source row the live adapter scrapes ("North Shore Wanderers
 * H3 Hareline Sheet") — the archive belongs to the same workbook, so this keeps
 * provenance honest.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-nswhhh-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nswhhh-history.ts
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { parseCSV, parseDate } from "@/adapters/google-sheets/adapter";
import { todayInTimezone } from "@/lib/timezone";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "North Shore Wanderers H3 Hareline Sheet";
const KENNEL_TIMEZONE = "Australia/Sydney";
const ARCHIVE_CSV_URL =
  "https://docs.google.com/spreadsheets/d/14vp2bq4MYMLDGlxuIfZS8MeJpenzpBTOV2nWicrphSE/export?format=csv&gid=360703890";

// Archive tab columns: Date | Run # | Hare | (sporadic location/area).
const COL = { date: 0, runNumber: 1, hares: 2, location: 3 } as const;

async function fetchArchive(): Promise<RawEventData[]> {
  const res = await safeFetch(ARCHIVE_CSV_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)" },
    // safeFetch's direct-fetch path has no default timeout (only the proxy
    // branch does) — guard this one-shot read against a hung connection.
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Archive CSV fetch failed: HTTP ${res.status}`);
  }
  const rows = parseCSV(await res.text());
  const events: RawEventData[] = [];
  const today = new Date();
  // Kennel-local cutoff. The shared runBackfillScript also partitions
  // `date < today`, but filter here too so fetchArchive is self-contained and
  // a future archive tab that ever carries current/upcoming rows can't leak
  // live schedule data through the backfill path.
  const todayStr = todayInTimezone(KENNEL_TIMEZONE);

  // Skip the header row (index 0).
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const runCell = row[COL.runNumber]?.trim();
    // Require a numeric run # — cleanly drops "No run holiday", "Invited to
    // joint run …", blank rows, and trailing "." filler while keeping real
    // numbered runs (incl. descriptive ones like "Shared run with …").
    if (!runCell || !/^\d+$/.test(runCell)) continue;

    const date = parseDate(row[COL.date]?.trim() ?? "", today);
    if (!date) continue;
    if (date >= todayStr) continue; // past-only (defense in depth)

    const hares = row[COL.hares]?.trim() || undefined;
    const location = row[COL.location]?.trim() || undefined;
    events.push({
      date,
      kennelTags: ["nswhhh"],
      runNumber: Number.parseInt(runCell, 10),
      hares,
      location,
      startTime: "18:30",
      sourceUrl: ARCHIVE_CSV_URL,
    });
  }
  return events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Reading NSWHHH archive tab (gid=360703890)",
  fetchEvents: fetchArchive,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
