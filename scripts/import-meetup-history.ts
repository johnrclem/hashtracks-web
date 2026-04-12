/**
 * Import historical Meetup events from JSON files produced by the
 * Chrome historical-scrape prompt.
 *
 * Reads JSON arrays from stdin (piped from batch files), deduplicates
 * by fingerprint against existing RawEvents, and feeds through the
 * merge pipeline so canonical Events are created inline.
 *
 * Usage:
 *   # Dry run (no DB writes):
 *   cat scripts/data/avlh3-*.json | npx tsx scripts/import-meetup-history.ts --kennel avlh3 --source "Asheville H3 Meetup"
 *
 *   # Apply:
 *   cat scripts/data/avlh3-*.json | BACKFILL_APPLY=1 npx tsx scripts/import-meetup-history.ts --kennel avlh3 --source "Asheville H3 Meetup"
 *
 * Input format (one JSON array per file, concatenated via cat):
 *   [{"title": "...", "date": "2026-01-10", "startTime": "14:00", "location": "...", "url": "...", "attendees": 22}]
 *
 * Deduplication: uses the standard generateFingerprint() so events
 * already in the DB from the recurring Meetup adapter are skipped.
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { processRawEvents } from "@/pipeline/merge";
import { generateFingerprint } from "@/pipeline/fingerprint";
import type { RawEventData } from "@/adapters/types";

/** Shape of a single event row from the Chrome scrape JSON output. */
interface MeetupHistoryRow {
  title: string;
  date: string;       // YYYY-MM-DD
  startTime?: string;  // HH:MM
  location?: string | null;
  url?: string | null;
  attendees?: number | null;
}

/** Extract run number from a Meetup event title (e.g. "#850" or "Run #850"). */
function extractRunNumber(title: string): number | undefined {
  const match = title.match(/#(\d{2,5})\b/);
  if (!match) return undefined;
  const num = parseInt(match[1], 10);
  return Number.isFinite(num) && num >= 1 ? num : undefined;
}

/** Parse CLI arguments for --kennel and --source. */
function parseArgs(): { kennelCode: string; sourceName: string } {
  const args = process.argv.slice(2);
  let kennelCode = "";
  let sourceName = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--kennel" && args[i + 1]) kennelCode = args[++i];
    if (args[i] === "--source" && args[i + 1]) sourceName = args[++i];
  }
  if (!kennelCode || !sourceName) {
    console.error("Usage: ... | npx tsx scripts/import-meetup-history.ts --kennel <code> --source <name>");
    process.exit(1);
  }
  return { kennelCode, sourceName };
}

/** Read all of stdin into a string. */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/**
 * Parse concatenated JSON arrays from stdin. Each batch file is a [...]
 * array; when cat'd together they produce "]\n[" between files. We split
 * on that boundary and parse each chunk independently, which avoids the
 * fragile global-regex approach that could corrupt data containing "] ["
 * inside string values.
 */
function parseJsonArrays(raw: string): MeetupHistoryRow[] {
  const trimmed = raw.trim();

  // Fast path: single file, single array
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to multi-array parsing
  }

  // Multi-file: split on "]<whitespace>[" boundary, re-bracket each chunk
  const allRows: MeetupHistoryRow[] = [];
  const chunks = trimmed.split(/\]\s*\[/);
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    // Re-add the brackets stripped by the split
    if (i === 0) chunk = chunk + "]";
    else if (i === chunks.length - 1) chunk = "[" + chunk;
    else chunk = "[" + chunk + "]";

    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) allRows.push(...parsed);
    } catch (err) {
      console.warn(`[chunk ${i}] Failed to parse: ${(err as Error).message}`);
      console.warn(`  First 100 chars: ${chunk.slice(0, 100)}`);
    }
  }
  return allRows;
}

async function main() {
  const { kennelCode, sourceName } = parseArgs();
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Import Meetup history: kennel=${kennelCode} source="${sourceName}"`);
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}\n`);

  const raw = await readStdin();
  if (!raw.trim()) {
    console.error("No input on stdin. Pipe JSON files: cat data/*.json | npx tsx ...");
    process.exit(1);
  }

  const allRows = parseJsonArrays(raw);
  if (allRows.length === 0) {
    console.error("Parsed 0 rows from stdin — input may be malformed.");
    process.exit(1);
  }

  console.log(`Parsed ${allRows.length} rows from stdin.`);

  // Convert to RawEventData
  const events: RawEventData[] = [];
  let skipped = 0;
  for (const row of allRows) {
    if (!row.date || !row.title) { skipped++; continue; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) { skipped++; continue; }

    events.push({
      date: row.date,
      kennelTag: kennelCode,
      title: row.title,
      runNumber: extractRunNumber(row.title),
      startTime: row.startTime || undefined,
      location: row.location || undefined,
      sourceUrl: row.url || undefined,
    });
  }

  // Deduplicate within the batch by fingerprint
  const seen = new Set<string>();
  const unique: RawEventData[] = [];
  for (const event of events) {
    const fp = generateFingerprint(event);
    if (seen.has(fp)) continue;
    seen.add(fp);
    unique.push(event);
  }

  console.log(`Valid: ${events.length}, unique: ${unique.length}, skipped: ${skipped}`);
  if (unique.length === 0) { console.log("Nothing to import."); return; }

  // Sort by date for readable output
  unique.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Date range: ${unique[0].date} → ${unique.at(-1)!.date}`);
  console.log("\nFirst 3:");
  for (const ev of unique.slice(0, 3)) {
    console.log(`  ${ev.date} #${ev.runNumber ?? "?"} | ${ev.title?.slice(0, 50)} | loc=${ev.location?.slice(0, 30) ?? "-"}`);
  }
  console.log("Last 3:");
  for (const ev of unique.slice(-3)) {
    console.log(`  ${ev.date} #${ev.runNumber ?? "?"} | ${ev.title?.slice(0, 50)} | loc=${ev.location?.slice(0, 30) ?? "-"}`);
  }

  if (!apply) {
    console.log("\nDry run. Re-run with BACKFILL_APPLY=1 to write.");
    return;
  }

  const source = await prisma.source.findFirst({ where: { name: sourceName } });
  if (!source) throw new Error(`Source "${sourceName}" not found`);

  console.log(`\nDelegating ${unique.length} events to merge pipeline...`);
  const result = await processRawEvents(source.id, unique);
  console.log(
    `Done. created=${result.created} updated=${result.updated} skipped=${result.skipped} blocked=${result.blocked}`,
  );
  if (result.unmatched.length > 0) console.log(`Unmatched: ${result.unmatched.join(", ")}`);
  if (result.eventErrors > 0) {
    console.log(`Errors (${result.eventErrors}):`);
    for (const msg of result.eventErrorMessages.slice(0, 5)) console.log(`  ${msg}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
